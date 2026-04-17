/**
 * E2E Tests for Momiji Clipper Video Pipeline
 *
 * Tests cover:
 * - Video upload
 * - URL ingestion (YouTube, Twitch, Kick)
 * - Transcription
 * - Highlight detection
 * - Clip review and rendering
 */

import { test, expect } from '@playwright/test';

test.describe('Video Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test (assumes valid credentials)
    await page.goto('/login');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('SecureP@ssw0rd123!');
    await page.getByRole('button', { name: /login/i }).click();
    await page.waitForURL(/dashboard|home/i);
  });

  test.describe('Video Ingestion', () => {
    test('should upload video file', async ({ page }) => {
      await page.goto('/pipeline');

      // Click upload button
      await page.getByRole('button', { name: /upload/i }).click();

      // Select file (would need a test video file)
      const fileInput = page.getByRole('file');
      await fileInput.setInputFiles('test-video.mp4');

      // Should show progress
      await expect(page.getByText(/uploading|processing/i)).toBeVisible();
    });

    test('should download from YouTube URL', async ({ page }) => {
      await page.goto('/pipeline');

      // Enter YouTube URL
      await page.getByPlaceholder(/youtube|url/i).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      await page.getByRole('button', { name: /download/i }).click();

      // Should show progress
      await expect(page.getByText(/downloading/i)).toBeVisible();
    });

    test('should download from Twitch URL', async ({ page }) => {
      await page.goto('/pipeline');

      // Enter Twitch URL
      await page.getByPlaceholder(/twitch/i).fill('https://www.twitch.tv/videos/123456789');
      await page.getByRole('button', { name: /download/i }).click();

      // Should show progress
      await expect(page.getByText(/downloading/i)).toBeVisible();
    });

    test('should show error for invalid URL', async ({ page }) => {
      await page.goto('/pipeline');

      // Enter invalid URL
      await page.getByPlaceholder(/url/i).fill('not-a-valid-url');
      await page.getByRole('button', { name: /download/i }).click();

      // Should show error
      await expect(page.getByText(/invalid url|error/i)).toBeVisible();
    });
  });

  test.describe('Transcription', () => {
    test('should show transcription options', async ({ page }) => {
      // Navigate to transcription step (would need a video loaded)
      await page.goto('/pipeline');

      // Should show model selection
      await expect(page.getByLabel(/whisper model|model/i)).toBeVisible();
      await expect(page.getByLabel(/device/i)).toBeVisible();
    });

    test('should start transcription', async ({ page }) => {
      await page.goto('/pipeline');

      // Click transcribe button
      await page.getByRole('button', { name: /transcribe/i }).click();

      // Should show progress
      await expect(page.getByText(/transcribing/i)).toBeVisible();
    });

    test('should show transcription results', async ({ page }) => {
      await page.goto('/pipeline');

      // After transcription completes
      // Should show transcript text
      await expect(page.getByText(/transcript|segments/i)).toBeVisible();
    });
  });

  test.describe('Highlight Detection', () => {
    test('should show LLM model selection', async ({ page }) => {
      await page.goto('/pipeline');

      // Should show model dropdown
      await expect(page.getByLabel(/llm model|model/i)).toBeVisible();
    });

    test('should detect highlights', async ({ page }) => {
      await page.goto('/pipeline');

      // Click detect button
      await page.getByRole('button', { name: /detect|highlight/i }).click();

      // Should show progress
      await expect(page.getByText(/detecting|analyzing/i)).toBeVisible();
    });

    test('should display detected clips', async ({ page }) => {
      await page.goto('/pipeline');

      // Should show clip list
      await expect(page.getByText(/clip|virality score/i)).toBeVisible();
    });

    test('should show clip metadata', async ({ page }) => {
      await page.goto('/pipeline');

      // Should show clip details
      await expect(page.getByText(/title|start|end|reason/i)).toBeVisible();
    });
  });

  test.describe('Clip Review & Rendering', () => {
    test('should edit clip title', async ({ page }) => {
      await page.goto('/pipeline');

      // Edit clip title
      const titleInput = page.getByLabel(/title/i);
      await titleInput.fill('New Clip Title');
      await titleInput.press('Enter');

      // Should save
      await expect(page.getByText(/saved/i)).toBeVisible();
    });

    test('should adjust clip timestamps', async ({ page }) => {
      await page.goto('/pipeline');

      // Adjust start time
      const startInput = page.getByLabel(/start time/i);
      await startInput.fill('10.5');

      // Adjust end time
      const endInput = page.getByLabel(/end time/i);
      await endInput.fill('40.5');
    });

    test('should select crop region', async ({ page }) => {
      await page.goto('/pipeline');

      // Should show crop canvas
      await expect(page.getByText(/crop|avatar|gameplay/i)).toBeVisible();
    });

    test('should configure subtitle style', async ({ page }) => {
      await page.goto('/pipeline');

      // Select caption style
      await page.getByLabel(/caption style/i).selectOption('karaoke');

      // Select font
      await page.getByLabel(/font/i).selectOption('Arial');
    });

    test('should render clip', async ({ page }) => {
      await page.goto('/pipeline');

      // Click render button
      await page.getByRole('button', { name: /render/i }).click();

      // Should show progress
      await expect(page.getByText(/rendering/i)).toBeVisible();
    });

    test('should download rendered clip', async ({ page }) => {
      await page.goto('/pipeline');

      // After rendering
      // Should show download button
      await expect(page.getByRole('button', { name: /download/i })).toBeVisible();
    });
  });
});
