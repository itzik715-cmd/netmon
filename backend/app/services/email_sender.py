"""
Reusable SMTP email utility.
Reads configuration from SystemSettings and sends emails via smtplib.
"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.settings import SystemSetting

logger = logging.getLogger(__name__)


async def _get_setting(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == key))
    setting = result.scalar_one_or_none()
    return setting.value if setting and setting.value else default


async def send_email(db: AsyncSession, to_address: str, subject: str, body_html: str) -> bool:
    """Send an email using SMTP settings from the database.

    Returns True on success, False on failure.
    """
    try:
        enabled = await _get_setting(db, "smtp_enabled", "false")
        if enabled.lower() != "true":
            logger.warning("SMTP is not enabled, skipping email send")
            return False

        host = await _get_setting(db, "smtp_host")
        port = int(await _get_setting(db, "smtp_port", "587"))
        username = await _get_setting(db, "smtp_username")
        password = await _get_setting(db, "smtp_password")
        use_tls = (await _get_setting(db, "smtp_use_tls", "true")).lower() == "true"
        from_address = await _get_setting(db, "smtp_from_address", "netmon@localhost")
        from_name = await _get_setting(db, "smtp_from_name", "NetMon")

        if not host:
            logger.error("SMTP host not configured")
            return False

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{from_address}>"
        msg["To"] = to_address
        msg.attach(MIMEText(body_html, "html"))

        with smtplib.SMTP(host, port, timeout=15) as server:
            if use_tls:
                server.starttls()
            if username and password:
                server.login(username, password)
            server.sendmail(from_address, [to_address], msg.as_string())

        logger.info(f"Email sent to {to_address}: {subject}")
        return True

    except Exception as e:
        logger.error(f"Failed to send email to {to_address}: {e}")
        return False
