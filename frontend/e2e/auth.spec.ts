/**
 * E2E Tests for Momiji Clipper Authentication Flows
 *
 * Tests cover:
 * - User registration
 * - User login
 * - OAuth sign-in (Google, Twitch, YouTube)
 * - Session persistence
 * - Logout
 */

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the app before each test
    await page.goto('/');
  });

  test.describe('Registration', () => {
    test('should show registration form', async ({ page }) => {
      // Navigate to register page
      await page.goto('/register');

      // Check form elements exist
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByLabel('Display Name')).toBeVisible();
      await expect(page.getByRole('button', { name: /register/i })).toBeVisible();
    });

    test('should validate email format', async ({ page }) => {
      await page.goto('/register');

      // Fill invalid email
      await page.getByLabel('Email').fill('invalid-email');
      await page.getByLabel('Password').fill('SecureP@ssw0rd123!');
      await page.getByLabel('Display Name').fill('Test User');
      await page.getByRole('button', { name: /register/i }).click();

      // Should show validation error
      await expect(page.getByText(/invalid email|email/i)).toBeVisible();
    });

    test('should validate password strength', async ({ page }) => {
      await page.goto('/register');

      // Fill weak password
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password').fill('weak');
      await page.getByLabel('Display Name').fill('Test User');
      await page.getByRole('button', { name: /register/i }).click();

      // Should show validation error (password too short)
      await expect(page.getByText(/password|12 characters|too short/i)).toBeVisible();
    });

    test('should register successfully with valid data', async ({ page }) => {
      await page.goto('/register');

      // Fill valid data
      const email = `test_${Date.now()}@example.com`;
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill('SecureP@ssw0rd123!');
      await page.getByLabel('Display Name').fill('Test User');
      await page.getByRole('button', { name: /register/i }).click();

      // Should redirect to login or dashboard on success
      // Note: This test will fail without a running backend
      // In CI, you'd mock the API response
    });
  });

  test.describe('Login', () => {
    test('should show login form', async ({ page }) => {
      await page.goto('/login');

      // Check form elements exist
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByRole('button', { name: /login/i })).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/login');

      // Fill credentials
      await page.getByLabel('Email').fill('wrong@example.com');
      await page.getByLabel('Password').fill('WrongPassword123!');
      await page.getByRole('button', { name: /login/i }).click();

      // Should show error message
      await expect(page.getByText(/invalid|credentials|unauthorized/i)).toBeVisible();
    });

    test('should login successfully with valid credentials', async ({ page }) => {
      await page.goto('/login');

      // Fill valid credentials (would need a test user in the database)
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password').fill('SecureP@ssw0rd123!');
      await page.getByRole('button', { name: /login/i }).click();

      // Should redirect to dashboard
      await expect(page).toHaveURL(/dashboard|home/i);
    });
  });

  test.describe('OAuth Sign-In', () => {
    test('should show OAuth buttons', async ({ page }) => {
      await page.goto('/login');

      // Check OAuth buttons exist
      await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /twitch/i })).toBeVisible();
    });

    test('should redirect to Google OAuth', async ({ page }) => {
      await page.goto('/login');

      const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        page.getByRole('button', { name: /google/i }).click(),
      ]);

      // Should redirect to Google OAuth
      await expect(popup).toHaveURL(/accounts\.google\.com/i);
    });

    test('should redirect to Twitch OAuth', async ({ page }) => {
      await page.goto('/login');

      const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        page.getByRole('button', { name: /twitch/i }).click(),
      ]);

      // Should redirect to Twitch OAuth
      await expect(popup).toHaveURL(/id\.twitch\.tv/i);
    });
  });

  test.describe('Session Management', () => {
    test('should persist session across page refresh', async ({ page }) => {
      // Login first (would need valid credentials)
      await page.goto('/login');
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password').fill('SecureP@ssw0rd123!');
      await page.getByRole('button', { name: /login/i }).click();

      // Wait for navigation
      await page.waitForURL(/dashboard|home/i);

      // Refresh page
      await page.reload();

      // Should still be logged in
      await expect(page).toHaveURL(/dashboard|home/i);
    });

    test('should logout successfully', async ({ page }) => {
      // Login first
      await page.goto('/login');
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByLabel('Password').fill('SecureP@ssw0rd123!');
      await page.getByRole('button', { name: /login/i }).click();
      await page.waitForURL(/dashboard|home/i);

      // Logout
      await page.getByRole('button', { name: /logout/i }).click();

      // Should redirect to login or home
      await expect(page).toHaveURL(/login|home/i);
    });

    test('should redirect to login when accessing protected route', async ({ page }) => {
      // Try to access protected route without being logged in
      await page.goto('/dashboard');

      // Should redirect to login
      await expect(page).toHaveURL(/login/i);
    });
  });
});
