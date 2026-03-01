-- NetMon Platform - Database Initialization
-- This file runs automatically on first PostgreSQL startup

-- Enable useful extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Create indexes for time-series performance after table creation
-- (Tables are created by SQLAlchemy/Alembic on app startup)

-- The application will create all tables via SQLAlchemy on first run.
-- Default admin user (admin/admin) is created by the application startup.

SELECT 'NetMon DB initialized' AS status;
