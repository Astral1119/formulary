import asyncio
from pathlib import Path
from rich.console import Console

console = Console()


class AuthenticationError(Exception):
    """raised when authentication fails or is cancelled."""
    pass


from typing import Tuple, List, Dict, Any

# google sets these cookies only for an authenticated session, so their presence
# is a reliable signed-in signal. the old check waited for an account-bar element
# that also renders when signed out, which is why it passed without a real login.
_GOOGLE_AUTH_COOKIES = {"SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID"}


def _has_google_auth_cookies(cookies: List[Dict[str, Any]]) -> bool:
    for c in cookies:
        name = c.get("name", "")
        domain = c.get("domain", "")
        if name in _GOOGLE_AUTH_COOKIES and domain.endswith("google.com") and c.get("value"):
            return True
    return False


async def authenticate_profile(profile_path: Path) -> Tuple[str, str, List[Dict[str, Any]]]:
    """
    open browser and authenticate with Google.

    args:
        profile_path: directory to store Playwright profile data

    returns:
        tuple of (email, user_agent, cookies)

    raises:
        AuthenticationError: if auth fails or is cancelled
    """
    from ..sheets.driver import PlaywrightDriver

    console.print("[blue]Opening browser for Google authentication...[/blue]")
    console.print("[dim]Please sign in with your Google account[/dim]")

    # ensure profile directory exists
    profile_path.mkdir(parents=True, exist_ok=True)

    # create driver with headed browser for authentication
    driver = PlaywrightDriver(
        headless=False,  # must be headed for user to authenticate
        user_data_dir=profile_path
    )

    try:
        await driver.start()

        # navigate to Google Sheets to trigger authentication
        page = driver.page
        await page.goto("https://docs.google.com/spreadsheets/", wait_until="networkidle")

        # wait for the user to actually sign in. we detect a real signed-in state
        # by the presence of google auth cookies, not a DOM element (the account
        # bar renders signed out too, which is what made this pass without a login).
        console.print("[yellow]Waiting for authentication...[/yellow]")

        timeout_s = 300  # 5 minutes to allow for MFA
        poll_s = 2
        elapsed = 0
        while elapsed < timeout_s:
            if _has_google_auth_cookies(await driver.get_cookies()):
                break
            await asyncio.sleep(poll_s)
            elapsed += poll_s
        else:
            raise AuthenticationError(
                "Authentication timed out. "
                "Please try again and complete the sign-in process."
            )

        # signed in, so reload sheets to surface the account bar, then read details
        await page.goto("https://docs.google.com/spreadsheets/", wait_until="networkidle")
        email = await _extract_email(page)
        user_agent = await page.evaluate("navigator.userAgent")
        cookies = await driver.get_cookies()

        if email:
            console.print(f"[green]✓[/green] Authenticated as [cyan]{email}[/cyan]")
        else:
            console.print("[green]✓[/green] Authenticated")

        return email, user_agent, cookies

    finally:
        await driver.stop()


async def _extract_email(page) -> str:
    """extract the signed-in account email from a Google page (best-effort)."""
    import re
    email_re = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    try:
        # the signed-in account button carries the email in its aria-label,
        # e.g. "Google Account: Name (name@example.com)"
        try:
            btn = await page.wait_for_selector('[aria-label*="@"]', timeout=3000)
            if btn:
                label = await btn.get_attribute("aria-label") or ""
                m = re.search(email_re, label)
                if m:
                    return m.group(0)
        except Exception:
            pass

        # other common spots for the email
        for selector in ['[data-email]', 'div[data-account-email]']:
            try:
                element = await page.wait_for_selector(selector, timeout=2000)
                if element:
                    email = await element.get_attribute('data-email')
                    if email:
                        return email
                    text = await element.text_content()
                    if text and '@' in text:
                        return text.strip()
            except Exception:
                continue

        # fallback: scan page text
        content = await page.content()
        matches = re.findall(email_re, content)
        if matches:
            return matches[0]

        # auth is already confirmed via cookies, so email here is only cosmetic
        return ""

    except Exception:
        return ""
