# Hypanel Product Requirements Document

## Project Overview
Hypanel is a comprehensive server management panel for Hytale game servers, providing a modern web interface and robust backend API for managing multiple server instances.

## Core Requirements

### ✅ 1. Server Persistence (COMPLETED)
- Store server configurations in SQLite database
- Persist server state across daemon restarts  
- Implement canonical server roots at ~/hytale/<id>
- Handle ownership and permissions properly
- Restore server instances on startup

### ✅ 2. Hytale Server Installation Automation (COMPLETED)
- Integrate with official hytale-downloader
- Automate server file downloads and setup
- Track installation progress with real-time updates
- Handle installation states and error recovery
- Verify downloaded files integrity

### 🔄 3. Server Configuration Management (IN PROGRESS)
- Allow editing server settings after creation
- Update server properties via REST API
- Maintain consistency between database and config files
- Validate configuration changes
- Support partial updates to server settings

### ⏳ 4. File Management API
- Browse and manage server files
- Edit configuration files
- Upload/download server files
- Directory traversal support
- File permissions handling

### ⏳ 5. Backup and Restore Functionality
- Create server backups
- Schedule automatic backups
- Restore from backups
- Backup compression and storage management

### ⏳ 6. Scheduled Tasks and Automation
- Cron-like scheduling system
- Automated server restarts
- Scheduled backups
- Maintenance windows

### ⏳ 7. Enhanced Monitoring and Analytics
- Historical performance data
- Resource usage trends
- Player activity analytics
- Alert system for critical events

## Technical Requirements

### API Endpoints Required
- ✅ GET /api/servers - List servers
- ✅ POST /api/servers - Create server
- ✅ GET /api/servers/:id - Get server details
- ✅ DELETE /api/servers/:id - Delete server
- ✅ POST /api/servers/:id/start - Start server
- ✅ POST /api/servers/:id/stop - Stop server
- ✅ POST /api/servers/:id/restart - Restart server
- ✅ POST /api/servers/:id/command - Send command
- ✅ POST /api/servers/:id/install - Install server
- ✅ GET /api/servers/:id/logs - Get server logs
- ✅ GET /api/servers/:id/stats - Get server stats
- ✅ PUT /api/servers/:id - Update server configuration
- ⏳ GET /api/servers/:id/files/* - File management
- ⏳ POST /api/servers/:id/backup - Create backup
- ⏳ GET /api/servers/:id/backups - List backups
- ⏳ POST /api/servers/:id/restore/:backupId - Restore backup
- ⏳ POST /api/schedules - Create scheduled task
- ⏳ GET /api/schedules - List scheduled tasks
- ⏳ DELETE /api/schedules/:id - Delete scheduled task

### Database Schema
- ✅ servers table with core server information
- ✅ server_stats table for resource monitoring
- ✅ console_logs table for server output
- ⏳ backups table for backup management
- ⏳ scheduled_tasks table for automation

### WebSocket Events
- ✅ serverStatusChange - Server status updates
- ✅ serverLog - Real-time log streaming
- ✅ serverStats - Resource usage updates
- ✅ serverCommand - Command execution logs
- ✅ serverInstallProgress - Installation progress
- ⏳ serverBackupProgress - Backup operation progress
- ⏳ serverFileChange - File system changes

## Security Requirements
- Input validation and sanitization
- Authentication and authorization (future)
- Secure file handling with proper permissions
- Rate limiting for API endpoints
- Audit logging for administrative actions

## Performance Requirements
- Support for 100+ concurrent server instances
- Sub-second API response times
- Efficient resource usage monitoring
- Scalable database design
- Optimized WebSocket message handling

---

**Status**: Core server management functionality is complete. Next priority is implementing file management API.