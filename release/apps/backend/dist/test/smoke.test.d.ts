declare class SmokeTestSuite {
    private db;
    private testResults;
    constructor();
    setup(): Promise<void>;
    teardown(): Promise<void>;
    private fileExists;
    private runTest;
    testSQLiteOperations(): Promise<void>;
    testInstallStateMachine(): Promise<void>;
    testWebSocketEvents(): Promise<void>;
    testFullWorkflow(): Promise<void>;
    runAllTests(): Promise<void>;
}
export { SmokeTestSuite };
//# sourceMappingURL=smoke.test.d.ts.map