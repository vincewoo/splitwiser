from playwright.sync_api import sync_playwright, expect
import time

def verify_close_button():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 720})

        # 1. Login
        print("Navigating to Login...")
        page.goto("http://localhost:5173/login")

        print("Filling login form...")
        page.fill("input[type='email']", "test@example.com")
        page.fill("input[type='password']", "password123")

        print("Clicking Sign In...")
        page.click("button[type='submit']")

        # Wait for navigation to dashboard (or timeout)
        print("Waiting for navigation...")
        try:
            # Check for Dashboard title or URL
            expect(page).to_have_url("http://localhost:5173/", timeout=10000)
            print("Logged in successfully.")
        except AssertionError:
            print(f"Login might have failed or redirect is slow. Current URL: {page.url}")
            page.screenshot(path="verification/login_fail.png")
            raise

        # 2. Open Add Expense Modal
        print("Looking for Add Expense button...")
        try:
             # Try text first (works on desktop view)
             page.get_by_text("Add expense").first.click()
             print("Clicked 'Add expense' by text")
        except Exception as e:
             print(f"Could not find Add Expense button: {e}")
             page.screenshot(path="verification/dashboard.png")
             browser.close()
             raise

        # 3. Verify Modal Open and Close Button
        print("Waiting for modal...")
        # Check for "Scan Receipt" button which indicates modal is open
        expect(page.get_by_text("Scan Receipt")).to_be_visible()

        print("Verifying Close button...")
        # Use get_by_label which targets aria-label="Close modal"
        close_button = page.get_by_label("Close modal")
        expect(close_button).to_be_visible()

        # 4. Take Screenshot
        print("Taking verification screenshot...")
        page.screenshot(path="verification/verification.png")

        browser.close()

if __name__ == "__main__":
    verify_close_button()
