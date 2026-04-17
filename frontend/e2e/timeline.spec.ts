/**
 * E2E Tests for Momiji Clipper Timeline Editor
 *
 * Tests cover:
 * - Video playback controls
 * - Segment editing
 * - Marker management
 * - Undo/redo
 * - Media library
 */

import { test, expect } from '@playwright/test';

test.describe('Timeline Editor', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to timeline
    await page.goto('/login');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Password').fill('SecureP@ssw0rd123!');
    await page.getByRole('button', { name: /login/i }).click();
    await page.waitForURL(/dashboard|home/i);

    // Navigate to a project's timeline
    await page.goto('/timeline/project-1');
  });

  test.describe('Playback Controls', () => {
    test('should show video player', async ({ page }) => {
      // Should show video element
      await expect(page.locator('video')).toBeVisible();
    });

    test('should play video', async ({ page }) => {
      // Click play button
      await page.getByRole('button', { name: /play/i }).click();

      // Should show pause button
      await expect(page.getByRole('button', { name: /pause/i })).toBeVisible();
    });

    test('should pause video', async ({ page }) => {
      // Start playing
      await page.getByRole('button', { name: /play/i }).click();

      // Click pause
      await page.getByRole('button', { name: /pause/i }).click();

      // Should show play button
      await expect(page.getByRole('button', { name: /play/i })).toBeVisible();
    });

    test('should seek to specific time', async ({ page }) => {
      // Click on timeline scrubber
      const timeline = page.getByTestId('timeline');
      await timeline.click({ position: { x: 100, y: 10 } });

      // Time should update
      await expect(page.getByTestId('current-time')).not.toBeEmpty();
    });

    test('should zoom in/out', async ({ page }) => {
      // Zoom in
      await page.getByRole('button', { name: /zoom in/i }).click();

      // Timeline should expand
      const timeline = page.getByTestId('timeline');
      const initialWidth = await timeline.boundingBox();

      await page.getByRole('button', { name: /zoom in/i }).click();
      const zoomedWidth = await timeline.boundingBox();

      expect(zoomedWidth!.width).toBeGreaterThan(initialWidth!.width);
    });
  });

  test.describe('Segment Editing', () => {
    test('should select subtitle segment', async ({ page }) => {
      // Click on a segment
      const segment = page.getByTestId('subtitle-segment').first();
      await segment.click();

      // Should show selected state
      await expect(segment).toHaveClass(/selected|active/i);
    });

    test('should edit subtitle text', async ({ page }) => {
      // Select segment
      const segment = page.getByTestId('subtitle-segment').first();
      await segment.click();

      // Edit text
      const textarea = page.getByLabel(/subtitle text/i);
      await textarea.fill('New subtitle text');

      // Should save (auto-save or blur)
      await textarea.blur();
      await expect(page.getByText(/saved/i)).toBeVisible();
    });

    test('should split segment', async ({ page }) => {
      // Select segment
      await page.getByTestId('subtitle-segment').first().click();

      // Click split button
      await page.getByRole('button', { name: /split/i }).click();

      // Should create two segments
      const segments = page.getByTestId('subtitle-segment');
      await expect(segments).toHaveCount(2);
    });

    test('should delete segment', async ({ page }) => {
      const initialCount = await page.getByTestId('subtitle-segment').count();

      // Select and delete
      await page.getByTestId('subtitle-segment').first().click();
      await page.getByRole('button', { name: /delete/i }).click();

      // Should have one less segment
      await expect(page.getByTestId('subtitle-segment')).toHaveCount(initialCount - 1);
    });

    test('should trim segment boundaries', async ({ page }) => {
      // Select segment
      const segment = page.getByTestId('subtitle-segment').first();
      await segment.click();

      // Drag edge to trim
      const edge = segment.getByTestId('resize-handle');
      await edge.dragTo(segment, {
        targetPosition: { x: 50, y: 10 },
      });
    });
  });

  test.describe('Markers', () => {
    test('should add marker', async ({ page }) => {
      // Click add marker button
      await page.getByRole('button', { name: /add marker/i }).click();

      // Should show marker on timeline
      await expect(page.getByTestId('marker')).toBeVisible();
    });

    test('should edit marker label', async ({ page }) => {
      // Add marker
      await page.getByRole('button', { name: /add marker/i }).click();

      // Edit label
      const marker = page.getByTestId('marker').first();
      await marker.click();

      const labelInput = page.getByLabel(/marker label/i);
      await labelInput.fill('Important moment');

      await expect(marker).toContainText('Important moment');
    });

    test('should change marker color', async ({ page }) => {
      // Add marker
      await page.getByRole('button', { name: /add marker/i }).click();

      // Select marker
      const marker = page.getByTestId('marker').first();
      await marker.click();

      // Change color
      await page.getByLabel(/marker color/i).fill('#FF5733');

      // Should update color
      await expect(marker).toHaveCSS('background-color', /rgb\(255, 87, 51\)/i);
    });

    test('should delete marker', async ({ page }) => {
      // Add marker
      await page.getByRole('button', { name: /add marker/i }).click();

      const initialCount = await page.getByTestId('marker').count();

      // Delete marker
      await page.getByTestId('marker').first().click();
      await page.getByRole('button', { name: /delete marker/i }).click();

      // Should have one less marker
      await expect(page.getByTestId('marker')).toHaveCount(initialCount - 1);
    });

    test('should navigate to marker time', async ({ page }) => {
      // Add marker
      await page.getByRole('button', { name: /add marker/i }).click();

      // Click marker to navigate
      await page.getByTestId('marker').first().click();

      // Video should seek to marker time
      const currentTime = page.getByTestId('current-time');
      await expect(currentTime).not.toBeEmpty();
    });
  });

  test.describe('Undo/Redo', () => {
    test('should undo edit', async ({ page }) => {
      // Make an edit
      const segment = page.getByTestId('subtitle-segment').first();
      await segment.click();

      const textarea = page.getByLabel(/subtitle text/i);
      const originalText = await textarea.inputValue();

      await textarea.fill('Changed text');
      await textarea.blur();

      // Undo
      await page.keyboard.down('Control');
      await page.keyboard.press('z');
      await page.keyboard.up('Control');

      // Should restore original text
      await expect(textarea).toHaveValue(originalText);
    });

    test('should redo edit', async ({ page }) => {
      // Make an edit
      const segment = page.getByTestId('subtitle-segment').first();
      await segment.click();

      const textarea = page.getByLabel(/subtitle text/i);
      await textarea.fill('Changed text');
      await textarea.blur();

      // Undo
      await page.keyboard.down('Control');
      await page.keyboard.press('z');
      await page.keyboard.up('Control');

      // Redo
      await page.keyboard.down('Control');
      await page.keyboard.press('y');
      await page.keyboard.up('Control');

      // Should restore changed text
      await expect(textarea).toHaveValue('Changed text');
    });

    test('should undo multiple times', async ({ page }) => {
      // Make multiple edits
      for (let i = 0; i < 3; i++) {
        const segment = page.getByTestId('subtitle-segment').first();
        await segment.click();
        const textarea = page.getByLabel(/subtitle text/i);
        await textarea.fill(`Edit ${i}`);
        await textarea.blur();
      }

      // Undo 3 times
      for (let i = 0; i < 3; i++) {
        await page.keyboard.down('Control');
        await page.keyboard.press('z');
        await page.keyboard.up('Control');
      }
    });
  });

  test.describe('Media Library', () => {
    test('should open media library', async ({ page }) => {
      // Click media library button
      await page.getByRole('button', { name: /media library/i }).click();

      // Should show media panel
      await expect(page.getByTestId('media-library')).toBeVisible();
    });

    test('should upload media', async ({ page }) => {
      // Open media library
      await page.getByRole('button', { name: /media library/i }).click();

      // Click upload
      await page.getByRole('button', { name: /upload media/i }).click();

      // Select file
      const fileInput = page.getByTestId('media-upload-input');
      await fileInput.setInputFiles('test-image.png');

      // Should show upload progress
      await expect(page.getByText(/uploading/i)).toBeVisible();
    });

    test('should place media on timeline', async ({ page }) => {
      // Open media library
      await page.getByRole('button', { name: /media library/i }).click();

      // Drag media to timeline
      const mediaItem = page.getByTestId('media-item').first();
      const timeline = page.getByTestId('timeline');

      await mediaItem.dragTo(timeline);

      // Should show overlay track
      await expect(page.getByTestId('overlay-track')).toBeVisible();
    });

    test('should delete media', async ({ page }) => {
      // Open media library
      await page.getByRole('button', { name: /media library/i }).click();

      const initialCount = await page.getByTestId('media-item').count();

      // Delete media
      await page.getByTestId('media-item').first().hover();
      await page.getByRole('button', { name: /delete/i }).click();

      // Should have one less item
      await expect(page.getByTestId('media-item')).toHaveCount(initialCount - 1);
    });
  });

  test.describe('Keyboard Shortcuts', () => {
    test('should play/pause with spacebar', async ({ page }) => {
      // Press space to play
      await page.keyboard.press(' ');

      // Should show pause button
      await expect(page.getByRole('button', { name: /pause/i })).toBeVisible();

      // Press space to pause
      await page.keyboard.press(' ');

      // Should show play button
      await expect(page.getByRole('button', { name: /play/i })).toBeVisible();
    });

    test('should undo with Ctrl+Z', async ({ page }) => {
      // Make an edit
      const segment = page.getByTestId('subtitle-segment').first();
      await segment.click();
      const textarea = page.getByLabel(/subtitle text/i);
      await textarea.fill('Changed');
      await textarea.blur();

      // Press Ctrl+Z
      await page.keyboard.down('Control');
      await page.keyboard.press('z');
      await page.keyboard.up('Control');

      // Should undo
      await expect(textarea).not.toHaveValue('Changed');
    });

    test('should save with Ctrl+S', async ({ page }) => {
      // Make an edit
      const segment = page.getByTestId('subtitle-segment').first();
      await segment.click();
      const textarea = page.getByLabel(/subtitle text/i);
      await textarea.fill('Changed');

      // Press Ctrl+S
      await page.keyboard.down('Control');
      await page.keyboard.press('s');
      await page.keyboard.up('Control');

      // Should show saved message
      await expect(page.getByText(/saved/i)).toBeVisible();
    });
  });
});
