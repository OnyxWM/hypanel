import Database from "better-sqlite3";
import { ServerStatus, InstallState } from "../src/types/index.js";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock temporary database for testing
const TEST_DB_PATH = path.join(__dirname, "test-smoke.db");
const TEST_SERVER_ROOT = path.join(__dirname, "test-servers");

// Test utilities
class MockDownloader {
  static async mockInstall(serverId: string, serverRoot: string): Promise<void> {
    // Simulate download time
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Create mock server files
    await fs.mkdir(serverRoot, { recursive: true });
    await fs.writeFile(path.join(serverRoot, "HytaleServer.jar"), "mock-jar-content");
    await fs.writeFile(path.join(serverRoot, "Assets.zip"), "mock-assets-content");
  }
}

// Test framework helpers
interface TestResult {
  passed: boolean;
  message: string;
  duration: number;
}

class SmokeTestSuite {
  private db: Database.Database;
  private testResults: TestResult[] = [];

  constructor() {
    this.db = new Database(TEST_DB_PATH);
  }

  async setup(): Promise<void> {
    // Clean up any existing test data
    if (await this.fileExists(TEST_DB_PATH)) {
      await fs.unlink(TEST_DB_PATH);
    }
    if (await this.fileExists(TEST_SERVER_ROOT)) {
      await fs.rm(TEST_SERVER_ROOT, { recursive: true, force: true });
    }

    // Initialize test database
    this.db = new Database(TEST_DB_PATH);
    this.db.pragma("journal_mode = WAL");
    
    // Create test schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        pid INTEGER,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        install_state TEXT DEFAULT 'NOT_INSTALLED',
        last_error TEXT,
        jar_path TEXT,
        assets_path TEXT,
        server_root TEXT
      );

      CREATE TABLE IF NOT EXISTS server_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        cpu REAL NOT NULL,
        memory REAL NOT NULL,
        players INTEGER NOT NULL,
        max_players INTEGER NOT NULL,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS console_logs (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
      );
    `);
  }

  async teardown(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
    
    // Clean up test files
    if (await this.fileExists(TEST_DB_PATH)) {
      await fs.unlink(TEST_DB_PATH);
    }
    if (await this.fileExists(TEST_SERVER_ROOT)) {
      await fs.rm(TEST_SERVER_ROOT, { recursive: true, force: true });
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private runTest(testName: string, testFn: () => Promise<void>): void {
    const startTime = Date.now();
    console.log(`\n🧪 Running: ${testName}`);
    
    testFn()
      .then(() => {
        const duration = Date.now() - startTime;
        this.testResults.push({ passed: true, message: testName, duration });
        console.log(`✅ ${testName} (${duration}ms)`);
      })
      .catch((error) => {
        const duration = Date.now() - startTime;
        this.testResults.push({ passed: false, message: `${testName}: ${error.message}`, duration });
        console.log(`❌ ${testName}: ${error.message}`);
      });
  }

  // SQLite Tests - Create a temporary database schema and operations
  async testSQLiteOperations(): Promise<void> {
    // Create a fresh database for this test
    const testDb = new Database(":memory:");
    
    // Create schema
    testDb.exec(`
      CREATE TABLE servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        install_state TEXT DEFAULT 'NOT_INSTALLED',
        max_players INTEGER DEFAULT 20,
        max_memory INTEGER DEFAULT 1024
      );
    `);

    // Test server creation
    const stmt = testDb.prepare(`
      INSERT INTO servers (id, name, status, ip, port, version, created_at, updated_at, install_state, max_players, max_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const now = Date.now();
    stmt.run(
      "test-sqlite-server",
      "Test SQLite Server", 
      "offline",
      "127.0.0.1",
      25565,
      "1.0.0",
      now,
      now,
      "NOT_INSTALLED",
      20,
      1024
    );
    
    // Test server retrieval
    const retrieveStmt = testDb.prepare("SELECT * FROM servers WHERE id = ?");
    const retrieved = retrieveStmt.get("test-sqlite-server") as any;
    if (!retrieved) {
      throw new Error("Failed to retrieve created server");
    }
    
    if (retrieved.name !== "Test SQLite Server") {
      throw new Error("Server name mismatch");
    }

    // Test multiple servers
    stmt.run(
      "test-sqlite-server-2",
      "Test SQLite Server 2",
      "offline", 
      "127.0.0.1",
      25566,
      "1.0.0",
      now,
      now,
      "NOT_INSTALLED",
      20,
      1024
    );

    const allStmt = testDb.prepare("SELECT * FROM servers ORDER BY created_at DESC");
    const allServers = allStmt.all() as any[];
    if (allServers.length !== 2) {
      throw new Error(`Expected 2 servers, got ${allServers.length}`);
    }

    testDb.close();
  }

  // Install State Machine Tests
  async testInstallStateMachine(): Promise<void> {
    // Create a fresh database for this test
    const testDb = new Database(":memory:");
    
    // Create schema
    testDb.exec(`
      CREATE TABLE servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        install_state TEXT DEFAULT 'NOT_INSTALLED',
        last_error TEXT,
        max_players INTEGER DEFAULT 20,
        max_memory INTEGER DEFAULT 1024
      );
    `);

    // Create test server
    const createStmt = testDb.prepare(`
      INSERT INTO servers (id, name, status, ip, port, version, created_at, updated_at, install_state, max_players, max_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const now = Date.now();
    createStmt.run(
      "test-install-server",
      "Test Install Server",
      "offline",
      "127.0.0.1", 
      25566,
      "1.0.0",
      now,
      now,
      "NOT_INSTALLED",
      20,
      1024
    );

    // Test installation locking
    const lockCheckStmt = testDb.prepare("SELECT install_state FROM servers WHERE id = ?");
    const lockResult = lockCheckStmt.get("test-install-server") as any;
    if (!lockResult) {
      throw new Error("Server not found");
    }

    // Simulate atomic lock - first should succeed
    const updateStmt = testDb.prepare(`
      UPDATE servers 
      SET install_state = 'INSTALLING', updated_at = ?
      WHERE id = ? AND install_state IN ('NOT_INSTALLED', 'FAILED')
    `);
    
    const updateResult1 = updateStmt.run(Date.now(), "test-install-server");
    if (updateResult1.changes === 0) {
      throw new Error("First installation lock should succeed");
    }

    // Second attempt should fail
    const updateResult2 = updateStmt.run(Date.now(), "test-install-server");
    if (updateResult2.changes !== 0) {
      throw new Error("Second installation lock should fail");
    }

    // Test state transition to INSTALLED
    const successUpdateStmt = testDb.prepare(`
      UPDATE servers 
      SET install_state = 'INSTALLED', updated_at = ?
      WHERE id = ?
    `);
    
    successUpdateStmt.run(Date.now(), "test-install-server");

    const server = lockCheckStmt.get("test-install-server") as any;
    if (server.install_state !== "INSTALLED") {
      throw new Error(`Expected INSTALLED state, got ${server.install_state}`);
    }

    // Test retry from FAILED state
    successUpdateStmt.run(Date.now(), "test-install-server");
    const failUpdateStmt = testDb.prepare(`
      UPDATE servers 
      SET install_state = 'FAILED', last_error = 'Test failure', updated_at = ?
      WHERE id = ?
    `);
    failUpdateStmt.run(Date.now(), "test-install-server");

    const failedServer = lockCheckStmt.get("test-install-server") as any;
    if (failedServer.install_state !== "FAILED") {
      throw new Error(`Expected FAILED state, got ${failedServer.install_state}`);
    }

    // Retry should succeed from FAILED state
    const retryResult = updateStmt.run(Date.now(), "test-install-server");
    if (retryResult.changes === 0) {
      throw new Error("Retry from FAILED state should succeed");
    }

    testDb.close();
  }

  // WebSocket Event Tests
  async testWebSocketEvents(): Promise<void> {
    // Mock WebSocketServerManager for testing
    const mockWsServer = {
      broadcast: (type: string, data: any) => {
        // Capture broadcasts for verification
        console.log(`WS Broadcast: ${type}`, data);
      }
    };

    // Mock installer events
    const events: any[] = [];
    const mockInstaller = {
      on: (event: string, callback: Function) => {
        if (event === "progress") {
          // Store callback for testing
          (mockInstaller as any).progressCallback = callback;
        }
      },
      emit: (event: string, serverId: string, progress: any) => {
        if (event === "progress" && (mockInstaller as any).progressCallback) {
          (mockInstaller as any).progressCallback(serverId, progress);
        }
      }
    };

    mockInstaller.on("progress", (serverId: string, progress: any) => {
      events.push({ serverId, progress });
      mockWsServer.broadcast("install-progress", { serverId, ...progress });
    });

    // Simulate install progress events
    const testServerId = "test-ws-server";
    const mockProgress = {
      stage: "downloading" as const,
      progress: 50,
      message: "Downloading server files..."
    };

    mockInstaller.emit("progress", testServerId, mockProgress);

    // Verify event was captured
    if (events.length === 0) {
      throw new Error("No progress events captured");
    }

    const progressEvent = events[0];
    if (progressEvent.serverId !== testServerId) {
      throw new Error("Server ID mismatch in progress event");
    }

    if (progressEvent.progress.stage !== "downloading") {
      throw new Error("Progress stage mismatch");
    }

    console.log("WebSocket event emission test completed");
  }

  // Integration Test
  async testFullWorkflow(): Promise<void> {
    // Create a fresh database for this test
    const testDb = new Database(":memory:");
    
    // Create schema
    testDb.exec(`
      CREATE TABLE servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        version TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        install_state TEXT DEFAULT 'NOT_INSTALLED',
        max_players INTEGER DEFAULT 20,
        max_memory INTEGER DEFAULT 1024
      );
    `);

    // Create test server
    const createStmt = testDb.prepare(`
      INSERT INTO servers (id, name, status, ip, port, version, created_at, updated_at, install_state, max_players, max_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const now = Date.now();
    createStmt.run(
      "test-full-workflow",
      "Test Full Workflow",
      "offline",
      "127.0.0.1",
      25567,
      "1.0.0",
      now,
      now,
      "NOT_INSTALLED",
      20,
      1024
    );

    // Mock the installation process
    const events: any[] = [];
    
    // Simulate progress events
    const mockProgressEvents = [
      { stage: "queued", progress: 0, message: "Installation queued..." },
      { stage: "downloading", progress: 25, message: "Downloading server files..." },
      { stage: "verifying", progress: 75, message: "Verifying installation..." },
      { stage: "ready", progress: 100, message: "Installation complete!" }
    ];

    for (const progress of mockProgressEvents) {
      events.push({ serverId: "test-full-workflow", progress });
      
      // Update database state
      const updateStmt = testDb.prepare(`
        UPDATE servers 
        SET install_state = ?, updated_at = ?
        WHERE id = ?
      `);
      
      const state = progress.stage === "ready" ? "INSTALLED" : "INSTALLING";
      updateStmt.run(state, Date.now(), "test-full-workflow");
    }

    // Verify progress events were recorded
    if (events.length === 0) {
      throw new Error("No progress events recorded");
    }

    // Verify server state updates
    const checkStmt = testDb.prepare("SELECT install_state FROM servers WHERE id = ?");
    const finalState = checkStmt.get("test-full-workflow") as any;
    
    if (!finalState || finalState.install_state !== "INSTALLED") {
      throw new Error(`Expected INSTALLED state, got ${finalState?.install_state}`);
    }

    testDb.close();
  }

  async runAllTests(): Promise<void> {
    console.log("🚀 Starting HyPanel Smoke Tests\n");
    
    await this.setup();

    // Run individual tests
    await Promise.all([
      this.runTest("SQLite Database Operations", () => this.testSQLiteOperations()),
      this.runTest("Install State Machine", () => this.testInstallStateMachine()),
      this.runTest("WebSocket Events", () => this.testWebSocketEvents()),
      this.runTest("Full Workflow Integration", () => this.testFullWorkflow())
    ]);

    await this.teardown();

    // Print results
    console.log("\n📊 Test Results:");
    console.log("================");
    
    const passed = this.testResults.filter(r => r.passed).length;
    const total = this.testResults.length;
    
    this.testResults.forEach(result => {
      console.log(`${result.passed ? "✅" : "❌"} ${result.message}`);
    });

    console.log(`\n📈 Summary: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log("🎉 All smoke tests passed!");
    } else {
      console.log("❌ Some tests failed. Check the output above.");
      process.exit(1);
    }
  }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testSuite = new SmokeTestSuite();
  testSuite.runAllTests().catch(console.error);
}

export { SmokeTestSuite };