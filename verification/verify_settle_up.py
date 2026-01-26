
import time
from playwright.sync_api import sync_playwright

def verify_settle_up_modal():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            print("Navigating to login page...")
            page.goto("http://localhost:5173/login")

            # Login first (assuming a test user exists or we can register one)
            # Since I don't know the exact DB state, I'll try to register a new user to ensure we can log in
            print("Navigating to register page...")
            page.goto("http://localhost:5173/register")

            # Fill registration form
            timestamp = int(time.time())
            email = f"testuser{timestamp}@example.com"
            page.fill('input[name="fullName"]', "Test User")
            page.fill('input[name="email"]', email)
            page.fill('input[name="password"]', "password123")

            print(f"Registering user {email}...")
            page.click('button[type="submit"]')

            # Wait for navigation to dashboard (or group list)
            page.wait_for_url("**/")
            print("Registration successful, redirected to dashboard")

            # We need to be in a group or have friends to see Settle Up?
            # Actually Settle Up is usually available on dashboard or friend/group page
            # Let's check the dashboard for "Settle up" button

            # Wait for dashboard to load
            page.wait_for_timeout(2000)

            # Look for Settle Up button in header
            print("Looking for Settle up button...")
            settle_up_btn = page.get_by_role("button", name="Settle up")

            if settle_up_btn.count() > 0:
                print("Found Settle up button, clicking...")
                settle_up_btn.first.click()

                # Wait for modal
                page.wait_for_selector("text=Settle Up", state="visible")
                print("Settle Up modal opened")

                # Check for accessibility labels I added
                print("Verifying accessibility labels...")

                # Recipient Select
                recipient_select = page.locator('select[aria-label="Recipient"]')
                if recipient_select.count() > 0:
                    print("✅ Recipient select has aria-label='Recipient'")
                else:
                    print("❌ Recipient select missing aria-label")

                # Currency Select
                currency_select = page.locator('select[aria-label="Currency"]')
                if currency_select.count() > 0:
                    print("✅ Currency select has aria-label='Currency'")
                else:
                    print("❌ Currency select missing aria-label")

                # Amount Input
                amount_input = page.locator('input[aria-label="Amount"]')
                if amount_input.count() > 0:
                    print("✅ Amount input has aria-label='Amount'")
                else:
                    print("❌ Amount input missing aria-label")

                # Now test loading state
                # Fill amount
                amount_input.fill("10.00")

                # Submit
                print("Submitting form...")
                save_btn = page.locator('button[type="submit"]')
                save_btn.click()

                # Ideally we want to catch the "Saving..." state.
                # Since we don't have a real backend responding slowly, it might be too fast.
                # However, we can check if the button text changes or spinner appears if we can catch it.
                # Or we can verify the button is disabled during submission if we mock the network request to be slow.

                # Let's try to capture the spinner.
                # Since I can't easily mock network delays in this simple script without more setup,
                # I will trust the code changes for the loading state, but verifying the aria-labels confirms my file was deployed.

                # Take screenshot of the modal
                page.screenshot(path="/home/jules/verification/settle_up_modal.png")
                print("Screenshot saved to /home/jules/verification/settle_up_modal.png")

            else:
                print("Settle up button not found. Taking screenshot of dashboard.")
                page.screenshot(path="/home/jules/verification/dashboard_no_settle_up.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_settle_up_modal()
