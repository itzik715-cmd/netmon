"""
Flow rollup service — aggregates raw flow_records into flow_summary_5m buckets.
Runs every 5 minutes via APScheduler.
"""
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

ROLLUP_LOOKBACK_MINUTES = 15


async def rollup_flows(db: AsyncSession) -> None:
    """Aggregate recent flow_records into 5-minute summary buckets.

    Uses INSERT ... ON CONFLICT DO UPDATE for idempotent upserts.
    Looks back 15 minutes to catch late-arriving data, skips current
    incomplete bucket.
    """
    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=ROLLUP_LOOKBACK_MINUTES)

    sql = text("""
        INSERT INTO flow_summary_5m
            (bucket, device_id, src_ip, dst_ip, src_port, dst_port,
             protocol_name, application, bytes, packets, flow_count)
        SELECT
            to_timestamp(floor(extract(epoch from fr.timestamp) / 300) * 300) AS bucket,
            fr.device_id,
            fr.src_ip,
            fr.dst_ip,
            COALESCE(fr.src_port, 0),
            COALESCE(fr.dst_port, 0),
            fr.protocol_name,
            fr.application,
            SUM(fr.bytes),
            SUM(fr.packets),
            COUNT(*)
        FROM flow_records fr
        WHERE fr.timestamp >= :since
          AND fr.timestamp < to_timestamp(floor(extract(epoch from now()) / 300) * 300)
        GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
        ON CONFLICT ON CONSTRAINT uq_flow_summary_5m_key
        DO UPDATE SET
            bytes = EXCLUDED.bytes,
            packets = EXCLUDED.packets,
            flow_count = EXCLUDED.flow_count
    """)

    try:
        result = await db.execute(sql, {"since": since})
        await db.commit()
        logger.info("Flow rollup: upserted summary rows for buckets since %s", since.strftime("%H:%M"))
    except Exception as e:
        logger.error("Flow rollup failed: %s", e)
        await db.rollback()


async def backfill_summaries(db: AsyncSession, days: int = 30) -> None:
    """One-time backfill of historical data into flow_summary_5m.

    Processes in 1-hour chunks to avoid memory/lock pressure.
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    chunk = timedelta(hours=1)

    current = start
    total_chunks = 0
    while current < now:
        chunk_end = min(current + chunk, now)
        sql = text("""
            INSERT INTO flow_summary_5m
                (bucket, device_id, src_ip, dst_ip, src_port, dst_port,
                 protocol_name, application, bytes, packets, flow_count)
            SELECT
                to_timestamp(floor(extract(epoch from fr.timestamp) / 300) * 300),
                fr.device_id,
                fr.src_ip,
                fr.dst_ip,
                COALESCE(fr.src_port, 0),
                COALESCE(fr.dst_port, 0),
                fr.protocol_name,
                fr.application,
                SUM(fr.bytes),
                SUM(fr.packets),
                COUNT(*)
            FROM flow_records fr
            WHERE fr.timestamp >= :start AND fr.timestamp < :end
            GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
            ON CONFLICT ON CONSTRAINT uq_flow_summary_5m_key
            DO UPDATE SET
                bytes = EXCLUDED.bytes,
                packets = EXCLUDED.packets,
                flow_count = EXCLUDED.flow_count
        """)

        try:
            await db.execute(sql, {"start": current, "end": chunk_end})
            await db.commit()
            total_chunks += 1
        except Exception as e:
            logger.error("Backfill chunk %s failed: %s", current, e)
            await db.rollback()

        current = chunk_end

    logger.info("Flow backfill complete: processed %d hourly chunks over %d days", total_chunks, days)
