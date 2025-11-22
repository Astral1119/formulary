import asyncio
from pathlib import Path
from rich.console import Console

console = Console()


class AuthenticationError(Exception):
    """raised when authentication fails or is cancelled."""
    pass


async def authenticate_profile(profile_path: Path) -> str:
    """
    open browser and authenticate with Google.
    
    args:
        profile_path: directory to store Playwright profile data
        
    returns:
        authenticated email address
        
    raises:
        AuthenticationError: if auth fails or is cancelled
    """
    from ..sheets.driver import PlaywrightDriver
    
    console.print("[blue]Opening browser for Google authentication...[/blue]")
    console.print("[dim]Please sign in with your Google account[/dim]")
    
    # ensure profile directory exists
    profile_path.mkdir(parents=True, exist_ok=True)
    
    # get browser choice
    browser = _get_browser_choice()
    
    # create driver with headed browser for authentication
    driver = PlaywrightDriver(
        headless=False,  # must be headed for user to authenticate
        user_data_dir=profile_path,
        browser=browser
    )
    
    try:
        await driver.start()
        
        # navigate to Google Sheets to trigger authentication
        page = driver.page
        await page.goto("https://docs.google.com/spreadsheets/", wait_until="networkidle")
        
        # wait for user to authenticate (check for signed-in state)
        console.print("[yellow]Waiting for authentication...[/yellow]")
        
        try:
            # wait for either:
            # 1. successful auth (profile icon appears)
            # 2. timeout (60 seconds)
            await page.wait_for_selector(
                'a[aria-label*="Google Account"], [data-ogpc="gb-google-account"]',
                timeout=60000  # 60 seconds
            )
            
            # try to extract email from the page
            email = await _extract_email(page)
            
            console.print(f"[green]✓[/green] Authenticated as [cyan]{email}[/cyan]")
            
            return email
            
        except Exception as e:
            raise AuthenticationError(
                "Authentication timed out or failed. "
                "Please try again and complete the sign-in process."
            )
    
    finally:
        await driver.stop()


def _get_browser_choice() -> str:
    """Read browser choice from installation config."""
    from ..config import get_config_dir
    browser_file = get_config_dir() / "browser_choice"
    if browser_file.exists():
        return browser_file.read_text().strip()
    return "chromium"  # default


async def _extract_email(page) -> str:
    """extract email from authenticated Google page."""
    try:
        # try common selectors for email in Google UI
        selectors = [
            '[data-email]',
            '[aria-label*="@"]',
            'div[data-account-email]',
        ]
        
        for selector in selectors:
            try:
                element = await page.wait_for_selector(selector, timeout=2000)
                if element:
                    email = await element.get_attribute('data-email')
                    if email:
                        return email
                    
                    text = await element.text_content()
                    if text and '@' in text:
                        return text.strip()
            except:
                continue
        
        # fallback: look for email pattern in page text
        content = await page.content()
        import re
        email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
        matches = re.findall(email_pattern, content)
        if matches:
            return matches[0]
        
        # if all else fails, return "(authenticated)"
        return "(authenticated)"
        
    except Exception:
        return "(authenticated)"
