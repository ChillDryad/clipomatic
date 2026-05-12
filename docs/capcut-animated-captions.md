# CapCut-Style Animated Captions Enhancement Plan (2025-2026)

## Executive Summary

This document outlines a comprehensive plan to enhance the clipomatic subtitle system with modern CapCut-style animated captions. The enhancement will add 4 new animation styles, emoji support, color scheme presets, and platform-specific configurations to increase viewer engagement and retention.

### Why This Matters

- **80% engagement boost** when captions are present
- **85% of social video** is watched without sound
- **Animated word highlighting** increases retention by 25-40%
- CapCut-style captions are now expected by viewers

---

## Current State Analysis

### Backend (`backend/pipeline/renderer.py`)

**Existing Capabilities:**

- ✅ 2 caption styles: `"karaoke"` (sweep fill with `\kf`) and `"capcut"` (solid highlight with `\c`)
- ✅ Basic ASS subtitle format with simple fade-in animations (`\fad`)
- ✅ Font customization (name, size, colors, outline)
- ✅ Word-level timestamps from Whisper
- ✅ Layout-aware positioning (stacked vs camera_only/gameplay_only)

**Limitations:**

- ❌ No advanced animations (pop, bounce, typewriter, scale pulse)
- ❌ No emoji support
- ❌ No color scheme presets
- ❌ No platform-specific configurations
- ❌ No animation speed control

### Frontend

**Existing UI:**

- ✅ Caption style selector (karaoke/capcut)
- ✅ Font, size, color customization
- ✅ `words_per_line` control (1-4 words)
- ✅ Quality presets (standard/production/nvenc)

**Components:**

- `ClipSectionSubtitles.tsx` — Main subtitle settings panel
- `TimelineToolbar.tsx` — Quick render settings
- `StepReview.tsx` — Review step configuration
- `ClipList.tsx` — Bulk clip operations

---

## Phase 1: Backend Enhancement — Advanced Animation Styles [**COMPLETED**]

### 1.1 Add New Animation Style Options 

**File:** `backend/pipeline/renderer.py`

**Changes:**

Expand `caption_style` parameter in `_build_ass_word_by_word()`:

```python
caption_style: str = "karaoke"  # Existing
# Add: "pop", "bounce", "typewriter", "scale_pulse"
```

**New Animation Generator Functions:**

```python
def _generate_pop_animation(word: str, duration_ms: int = 180) -> str:
    """
    Pop animation: scale 50% → 115% → 100%

    ASS tags:
    - \fscx/\fscy: Font scale X/Y
    - \t(start,end,transform): Animate over milliseconds

    Example: {\fscx50\fscy50\t(0,80,\fscx115\fscy115)\t(80,180,\fscx100\fscy100)}Word
    """
    return f"{{\\fscx50\\fscy50\\t(0,80,\\fscx115\\fscy115)\\t(80,180,\\fscx100\\fscy100)}}{word}"


def _generate_bounce_animation(word: str, start_y: int = 1100, end_y: int = 960) -> str:
    """
    Bounce from below with overshoot

    ASS tags:
    - \move(x1,y1,x2,y2): Move from (x1,y1) to (x2,y2)
    - \t(): Scale overshoot (115% → 95% → 100%)

    Example: {\move(540,1100,540,960)\t(0,120,\fscx115\fscy115)\t(120,200,\fscx95\fscy95)\t(200,280,\fscx100\fscy100)}Word
    """
    return (
        f"{{\\move(540,{start_y},540,{end_y})"
        f"\\t(0,120,\\fscx115\\fscy115)"
        f"\\t(120,200,\\fscx95\\fscy95)"
        f"\\t(200,280,\\fscx100\\fscy100)}}{word}"
    )


def _generate_typewriter_animation(text: str, char_duration_ms: int = 100) -> str:
    """
    Typewriter effect: characters appear one at a time

    Each character gets its own Dialogue line with incremental reveal.
    Returns list of Dialogue lines.
    """
    lines = []
    for i in range(1, len(text) + 1):
        revealed = text[:i]
        start_ms = (i - 1) * char_duration_ms
        end_ms = start_ms + 100  # Hold for 100ms
        lines.append((start_ms / 1000, end_ms / 1000, revealed))
    return lines


def _generate_scale_pulse_animation(word: str, emphasis: bool = False) -> str:
    """
    Scale pulse with optional emphasis

    Emphasis words pulse to 125%, normal words to 110%
    """
    scale = 125 if emphasis else 110
    return (
        f"{{\\fscx100\\fscy100"
        f"\\t(0,100,\\fscx{scale}\\fscy{scale})"
        f"\\t(100,200,\\fscx100\\fscy100)}}{word}"
    )
```

### 1.2 Update `_build_ass_word_by_word` Function

**New Parameters:**

```python
def _build_ass_word_by_word(
    segments: list[dict],
    clip_start: float,
    clip_end: float,
    font_name: str = "Arial",
    font_color: str = "&H00FFFFFF",
    highlight_color: str = "&H0000FFFF",
    outline_color: str = "&H00000000",
    outline_width: float = 2.0,
    shadow_color: str = "&H00000000",
    shadow_opacity: float = 0.5,
    font_size: int = 22,
    output_height: int = 1920,
    output_width: int = 1080,
    fade_in_ms: int = 0,
    caption_style: str = "karaoke",  # karaoke, capcut, pop, bounce, typewriter, scale_pulse
    words_per_line: int = 1,
    layout_mode: str = "stacked",
    animation_speed: str = "normal",  # fast, normal, slow
    emphasis_words: list[str] | None = None,  # Words to emphasize
) -> str:
```

**Animation Speed Mapping:**

```python
_SPEED_MAP = {
    "fast": {"pop_duration": 120, "bounce_duration": 200, "typewriter_ms": 60},
    "normal": {"pop_duration": 180, "bounce_duration": 280, "typewriter_ms": 100},
    "slow": {"pop_duration": 250, "bounce_duration": 400, "typewriter_ms": 150},
}
```

**Implementation Logic:**

```python
# Inside word-by-word loop
if caption_style == "pop":
    effect = _generate_pop_animation(text, speed_config["pop_duration"])
    lines.append(f"Dialogue: 0,{_seconds_to_ass_time(t0)},{_seconds_to_ass_time(t_end)},Default,,0,0,0,,{fade_tag}{effect}")

elif caption_style == "bounce":
    effect = _generate_bounce_animation(text)
    lines.append(f"Dialogue: 0,{_seconds_to_ass_time(t0)},{_seconds_to_ass_time(t_end)},Default,,0,0,0,,{fade_tag}{effect}")

elif caption_style == "typewriter":
    # Generate per-character lines
    char_lines = _generate_typewriter_animation(text, speed_config["typewriter_ms"])
    for char_start, char_end, char_text in char_lines:
        adjusted_start = t0 + char_start
        adjusted_end = t0 + char_end
        lines.append(f"Dialogue: 0,{_seconds_to_ass_time(adjusted_start)},{_seconds_to_ass_time(adjusted_end)},Typewriter,,0,0,0,,{char_text}")

elif caption_style == "scale_pulse":
    is_emphasis = emphasis_words and any(e.lower() in text.lower() for e in emphasis_words)
    effect = _generate_scale_pulse_animation(text, emphasis=is_emphasis)
    lines.append(f"Dialogue: 0,{_seconds_to_ass_time(t0)},{_seconds_to_ass_time(t_end)},Default,,0,0,0,,{fade_tag}{effect}")
```

### 1.3 Enhanced ASS Style Definitions

**Add Style Presets:**

```python
_STYLE_PRESETS = {
    "tiktok_viral": {
        "font": "Arial Black",
        "size": 84,
        "primary": "&H00FFFFFF",
        "highlight": "&H0000FFFF",
        "outline": "&H00000000",
        "outline_width": 6.0,
        "margin_v": 300,
    },
    "youtube_pro": {
        "font": "Montserrat",
        "size": 72,
        "primary": "&H00FFFFFF",
        "highlight": "&H00FFD700",
        "outline": "&H00333333",
        "outline_width": 4.0,
        "margin_v": 280,
    },
    "instagram_reels": {
        "font": "Impact",
        "size": 80,
        "primary": "&H00FFFFFF",
        "highlight": "&H00FF00FF",
        "outline": "&H00000000",
        "outline_width": 5.0,
        "margin_v": 260,
    }
}
```

**Update `_ass_style_header` to Support Presets:**

```python
def _ass_style_header(
    font_name: str,
    font_size: int,
    font_color: str,
    highlight_color: str,
    outline_color: str,
    outline_width: float,
    shadow_color: str,
    shadow_opacity: float,
    output_width: int,
    output_height: int,
    layout_mode: str = "stacked",
    style_preset: str | None = None,  # tiktok_viral, youtube_pro, etc.
) -> str:
    """Build ASS header with optional preset overrides."""

    # Apply preset if specified
    if style_preset and style_preset in _STYLE_PRESETS:
        preset = _STYLE_PRESETS[style_preset]
        font_name = preset.get("font", font_name)
        font_size = preset.get("size", font_size)
        font_color = preset.get("primary", font_color)
        highlight_color = preset.get("highlight", highlight_color)
        outline_color = preset.get("outline", outline_color)
        outline_width = preset.get("outline_width", outline_width)

    # ... rest of existing logic
```

---

## Phase 2: Backend — Emoji Support & Color Schemes

### 2.1 Emoji Integration

**Add Dependency:**

```bash
# requirements.txt
emoji==2.10.0
```

**Add Emoji Processing Function:**

```python
def _process_text_with_emojis(text: str, font_name: str) -> str:
    """
    Wrap emojis with emoji font tags for proper rendering.

    Uses font switching: {\fnSegoe UI Emoji}emoji{\fnArial}text
    """
    try:
        import emoji
        words = text.split()
        processed = []
        for word in words:
            # Check if word contains emoji
            if any(emoji.is_emoji(c) for c in word):
                processed.append(f"{{\\fnSegoe UI Emoji}}{word}{{\\fn{font_name}}}")
            else:
                processed.append(word)
        return " ".join(processed)
    except ImportError:
        # Fallback if emoji package not installed
        return text
```

**Update `_build_ass_word_by_word`:**

```python
# Add parameter
enable_emoji: bool = True

# In word processing loop
if enable_emoji:
    word_text = _process_text_with_emojis(word_text, font_name)
```

### 2.2 Color Scheme Presets

**Add Color Scheme Definitions:**

```python
_COLOR_SCHEMES = {
    "gaming": {
        "primary": "&H0000FFFF",      # Yellow
        "highlight": "&H000000FF",    # Red
        "outline": "&H00000000",      # Black
        "description": "High energy, gaming content",
    },
    "professional": {
        "primary": "&H00FFFFFF",      # White
        "highlight": "&H00FFD700",    # Gold
        "outline": "&H00333333",      # Dark Gray
        "description": "Professional, educational",
    },
    "lifestyle": {
        "primary": "&H00FFFFFF",      # White
        "highlight": "&H00FFC0CB",    # Pink
        "outline": "&H00000000",      # Black
        "description": "Lifestyle, aesthetic",
    },
    "comedy": {
        "primary": "&H00FFFFFF",      # White
        "highlight": "&H0000FF00",    # Green
        "outline": "&H00000000",      # Black
        "description": "Comedy, casual",
    },
}
```

**Add Helper Function:**

```python
def _apply_color_scheme(
    font_color: str,
    highlight_color: str,
    outline_color: str,
    scheme: str | None = None,
) -> tuple[str, str, str]:
    """Apply color scheme preset, returns (primary, highlight, outline)."""
    if scheme and scheme in _COLOR_SCHEMES:
        colors = _COLOR_SCHEMES[scheme]
        return colors["primary"], colors["highlight"], colors["outline"]
    return font_color, highlight_color, outline_color
```

---

## Phase 3: Frontend — Enhanced UI Controls

### 3.1 Update Subtitle Settings UI

**File:** `frontend/src/pages/VideoProjectPage/ClipSectionSubtitles.tsx`

**Add New State:**

```typescript
const [animationStyle, setAnimationStyle] = useState<
  "karaoke" | "capcut" | "pop" | "bounce" | "typewriter" | "scale_pulse"
>("karaoke");
const [animationSpeed, setAnimationSpeed] = useState<
  "fast" | "normal" | "slow"
>("normal");
const [colorScheme, setColorScheme] = useState<
  "gaming" | "professional" | "lifestyle" | "comedy"
>("professional");
const [enableEmoji, setEnableEmoji] = useState(true);
const [platformPreset, setPlatformPreset] = useState<
  "tiktok" | "youtube" | "instagram" | "facebook" | null
>(null);
```

**Add Animation Style Selector:**

```tsx
<div className="space-y-2">
  <label className="text-xs font-medium text-[var(--ctp-text)]">
    Animation Style
  </label>
  <div className="grid grid-cols-3 gap-2">
    {[
      { value: "karaoke", label: "Karaoke", desc: "Sweep fill" },
      { value: "capcut", label: "CapCut", desc: "Solid highlight" },
      { value: "pop", label: "Pop", desc: "Word bounce" },
      { value: "bounce", label: "Bounce", desc: "From below" },
      { value: "typewriter", label: "Typewriter", desc: "Char reveal" },
      { value: "scale_pulse", label: "Pulse", desc: "Scale emphasis" },
    ].map((style) => (
      <button
        key={style.value}
        onClick={() => update({ animationStyle: style.value })}
        className={`p-2 rounded border text-left ${
          animationStyle === style.value
            ? "border-[var(--ctp-mauve)] bg-[var(--ctp-surface-2)]"
            : "border-[var(--ctp-overlay)] hover:border-[var(--ctp-subtext)]"
        }`}
      >
        <div className="text-xs font-medium">{style.label}</div>
        <div className="text-[10px] text-[var(--ctp-subtext)]">
          {style.desc}
        </div>
      </button>
    ))}
  </div>
</div>
```

**Add Animation Speed Selector:**

```tsx
<div className="flex items-center gap-2">
  <label className="text-xs text-[var(--ctp-subtext)] min-w-[70px]">
    Animation Speed
  </label>
  <div className="flex gap-1">
    {(["fast", "normal", "slow"] as const).map((speed) => (
      <button
        key={speed}
        onClick={() => update({ animationSpeed: speed })}
        className={`px-3 py-1 rounded text-xs ${
          animationSpeed === speed
            ? "bg-[var(--ctp-mauve)] text-[var(--ctp-base)]"
            : "bg-[var(--ctp-surface-1)] text-[var(--ctp-subtext)]"
        }`}
      >
        {speed}
      </button>
    ))}
  </div>
</div>
```

**Add Color Scheme Selector:**

```tsx
<div className="space-y-2">
  <label className="text-xs font-medium text-[var(--ctp-text)]">
    Color Scheme
  </label>
  <div className="grid grid-cols-2 gap-2">
    {[
      { value: "gaming", label: "Gaming", colors: ["#FFFF00", "#FF0000"] },
      {
        value: "professional",
        label: "Professional",
        colors: ["#FFFFFF", "#FFD700"],
      },
      {
        value: "lifestyle",
        label: "Lifestyle",
        colors: ["#FFFFFF", "#FFC0CB"],
      },
      { value: "comedy", label: "Comedy", colors: ["#FFFFFF", "#00FF00"] },
    ].map((scheme) => (
      <button
        key={scheme.value}
        onClick={() => update({ colorScheme: scheme.value })}
        className={`p-2 rounded border flex items-center gap-2 ${
          colorScheme === scheme.value
            ? "border-[var(--ctp-mauve)] bg-[var(--ctp-surface-2)]"
            : "border-[var(--ctp-overlay)]"
        }`}
      >
        <div className="flex -space-x-1">
          {scheme.colors.map((c, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full border border-[var(--ctp-base)]"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <span className="text-xs">{scheme.label}</span>
      </button>
    ))}
  </div>
</div>
```

**Add Emoji Toggle:**

```tsx
<div className="flex items-center justify-between">
  <div>
    <label className="text-xs font-medium text-[var(--ctp-text)]">
      Emoji Support
    </label>
    <p className="text-[10px] text-[var(--ctp-subtext)]">
      Render emojis with proper font
    </p>
  </div>
  <button
    onClick={() => update({ enableEmoji: !enableEmoji })}
    className={`w-10 h-5 rounded-full relative transition-colors ${
      enableEmoji ? "bg-[var(--ctp-mauve)]" : "bg-[var(--ctp-overlay)]"
    }`}
  >
    <div
      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
        enableEmoji ? "left-5" : "left-0.5"
      }`}
    />
  </button>
</div>
```

**Add Platform Preset Selector:**

```tsx
<div className="space-y-2">
  <label className="text-xs font-medium text-[var(--ctp-text)]">
    Platform Preset
  </label>
  <div className="grid grid-cols-2 gap-2">
    {[
      { value: "tiktok", label: "TikTok", desc: "84px, Arial Black" },
      { value: "youtube", label: "YouTube", desc: "72px, Montserrat" },
      { value: "instagram", label: "Instagram", desc: "80px, Impact" },
      { value: "facebook", label: "Facebook", desc: "72px, Clear" },
    ].map((preset) => (
      <button
        key={preset.value}
        onClick={() => update({ platformPreset: preset.value })}
        className={`p-2 rounded border text-left ${
          platformPreset === preset.value
            ? "border-[var(--ctp-mauve)] bg-[var(--ctp-surface-2)]"
            : "border-[var(--ctp-overlay)]"
        }`}
      >
        <div className="text-xs font-medium">{preset.label}</div>
        <div className="text-[10px] text-[var(--ctp-subtext)]">
          {preset.desc}
        </div>
      </button>
    ))}
  </div>
  {platformPreset && (
    <button
      onClick={() => applyPlatformPreset(platformPreset)}
      className="btn-momiji-secondary text-xs w-full"
    >
      Apply {platformPreset} Settings
    </button>
  )}
</div>
```

### 3.2 Update API Types

**File:** `frontend/src/api.ts`

**Update `renderClip` Parameters:**

```typescript
export async function renderClip(
  params: {
    video_path: string;
    clip: { start: number; end: number };
    crop_avatar: { x: number; y: number; w: number; h: number };
    crop_game: { x: number; y: number; w: number; h: number };
    segments: unknown[];
    font_name: string;
    font_color: string;
    highlight_color: string;
    outline_color: string;
    outline_width: number;
    shadow_color: string;
    shadow_depth: number;
    shadow_opacity: number;
    font_size: number;
    subtitle_fade_in_ms: number;
    subtitle_fade_out_ms: number;
    caption_style: string;
    words_per_line: number;
    quality_preset: string;
    layout_mode: string;
    // NEW PARAMETERS
    animation_style?:
      | "karaoke"
      | "capcut"
      | "pop"
      | "bounce"
      | "typewriter"
      | "scale_pulse";
    animation_speed?: "fast" | "normal" | "slow";
    color_scheme?: "gaming" | "professional" | "lifestyle" | "comedy";
    enable_emoji?: boolean;
    platform_preset?: "tiktok" | "youtube" | "instagram" | "facebook";
  },
  onProgress: (p: number, label: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  // ... existing implementation
}
```

### 3.3 Timeline Editor Integration

**File:** `frontend/src/components/timeline/TimelineToolbar.tsx`

**Update `RenderSettings` Interface:**

```typescript
export interface RenderSettings {
  fontSize: number;
  wordsPerLine: number;
  qualityPreset: "standard" | "production" | "nvenc";
  captionStyle: "karaoke" | "capcut";
  // NEW
  animationStyle?: "pop" | "bounce" | "typewriter" | "scale_pulse";
  animationSpeed?: "fast" | "normal" | "slow";
  colorScheme?: "gaming" | "professional" | "lifestyle" | "comedy";
}
```

**Add Quick Selectors in Dropdown:**

```tsx
{
  /* Animation style quick select */
}
<div className="flex items-center gap-2">
  <label className="text-xs text-[var(--ctp-subtext)] min-w-[70px]">
    Animation
  </label>
  <select
    value={renderSettings.animationStyle || "karaoke"}
    onChange={(e) =>
      onRenderSettingsChange({
        ...renderSettings,
        animationStyle: e.target.value as any,
      })
    }
    className="flex-1 bg-[var(--ctp-surface-1)] rounded text-xs px-2 py-1"
  >
    <option value="karaoke">Karaoke</option>
    <option value="capcut">CapCut</option>
    <option value="pop">Pop</option>
    <option value="bounce">Bounce</option>
    <option value="typewriter">Typewriter</option>
    <option value="scale_pulse">Pulse</option>
  </select>
</div>
```

---

## Phase 4: Testing & Validation

### 4.1 Backend Tests

**File:** `backend/tests/unit/test_renderer.py`

**Test Cases:**

```python
def test_pop_animation_generates_correct_ass_tags():
    """Verify pop animation uses scale tags with correct timing"""
    from pipeline.renderer import _build_ass_word_by_word

    segments = [{
        "start": 0.0,
        "end": 1.0,
        "words": [{"word": "Test", "start": 0.0, "end": 1.0}]
    }]

    ass_content = _build_ass_word_by_word(
        segments=segments,
        clip_start=0.0,
        clip_end=1.0,
        caption_style="pop",
    )

    assert "\\fscx50\\fscy50" in ass_content
    assert "\\t(0,80,\\fscx115\\fscy115)" in ass_content
    assert "\\t(80,180,\\fscx100\\fscy100)" in ass_content


def test_bounce_animation_uses_move_tag():
    """Verify bounce animation uses \\move with correct coordinates"""
    ass_content = _build_ass_word_by_word(
        segments=[...],
        caption_style="bounce",
    )

    assert "\\move(540,1100,540,960)" in ass_content


def test_typewriter_generates_per_character_lines():
    """Verify typewriter creates multiple Dialogue lines"""
    ass_content = _build_ass_word_by_word(
        segments=[{
            "start": 0.0,
            "end": 1.0,
            "words": [{"word": "Hi", "start": 0.0, "end": 1.0}]
        }],
        caption_style="typewriter",
    )

    # Should have 2 Dialogue lines for 2 characters
    dialogue_count = ass_content.count("Dialogue: 0,")
    assert dialogue_count == 2


def test_emoji_font_switching():
    """Verify emojis get emoji font tags"""
    ass_content = _build_ass_word_by_word(
        segments=[...],
        enable_emoji=True,
    )

    assert "\\fnSegoe UI Emoji" in ass_content or "🔥" in ass_content


def test_color_scheme_application():
    """Verify color schemes override colors"""
    from pipeline.renderer import _apply_color_scheme

    primary, highlight, outline = _apply_color_scheme(
        font_color="#FFFFFF",
        highlight_color="#FFFF00",
        outline_color="#000000",
        scheme="gaming",
    )

    assert primary == "&H0000FFFF"  # Yellow
    assert highlight == "&H000000FF"  # Red
```

### 4.2 Frontend Tests

**File:** `frontend/src/pages/VideoProjectPage/__tests__/ClipSectionSubtitles.test.tsx`

```typescript
import { render, screen } from '@testing-library/react'
import { ClipSectionSubtitles } from '../ClipSectionSubtitles'

describe('ClipSectionSubtitles', () => {
  it('renders all animation style options', () => {
    render(<ClipSectionSubtitles {...defaultProps} />)

    expect(screen.getByText('Pop')).toBeInTheDocument()
    expect(screen.getByText('Bounce')).toBeInTheDocument()
    expect(screen.getByText('Typewriter')).toBeInTheDocument()
  })

  it('applies animation style selection', async () => {
    const mockUpdate = jest.fn()
    render(<ClipSectionSubtitles {...defaultProps} onUpdate={mockUpdate} />)

    const popButton = screen.getByText('Pop').closest('button')
    fireEvent.click(popButton!)

    expect(mockUpdate).toHaveBeenCalledWith({ animationStyle: 'pop' })
  })

  it('applies color scheme selection', async () => {
    const mockUpdate = jest.fn()
    render(<ClipSectionSubtitles {...defaultProps} onUpdate={mockUpdate} />)

    const gamingButton = screen.getByText('Gaming').closest('button')
    fireEvent.click(gamingButton!)

    expect(mockUpdate).toHaveBeenCalledWith({ colorScheme: 'gaming' })
  })

  it('toggles emoji support', async () => {
    const mockUpdate = jest.fn()
    render(<ClipSectionSubtitles {...defaultProps} onUpdate={mockUpdate} />)

    const emojiToggle = screen.getByText('Emoji Support').closest('button')
    fireEvent.click(emojiToggle!)

    expect(mockUpdate).toHaveBeenCalledWith({ enableEmoji: true })
  })
})
```

### 4.3 Integration Tests

**Test Scenarios:**

1. **Pop Animation Render Test**
   ```bash
   # Render clip with pop animation
   # Verify ASS contains \fscx/\fscy scale tags
   # Verify render completes successfully
   ```

2. **Emoji Support Test**
   ```bash
   # Render clip with emoji text "This is FIRE 🔥"
   # Verify ASS contains \fnSegoe UI Emoji tags
   # Verify emoji renders correctly in output video
   ```

3. **Gaming Color Scheme Test**
   ```bash
   # Apply gaming color scheme
   # Verify ASS contains yellow primary (&H0000FFFF)
   # Verify ASS contains red highlight (&H000000FF)
   ```

4. **TikTok Preset Test**
   ```bash
   # Apply TikTok preset
   # Verify font is Arial Black
   # Verify font size is 84px
   # Verify margin_v is 300
   ```

---

## Phase 5: Documentation & Examples

### 5.1 User Guide

**Create:** `docs/caption-styles.md`

**Content Outline:**

```markdown
# Caption Style Guide

## Animation Styles

### Karaoke (Default)

- **Effect:** Color sweeps across words as spoken
- **Best For:** Music videos, voiceovers, professional content
- **Example:** `{\kf50}This {\kf40}is {\kf60}karaoke`

### CapCut (Solid Highlight)

- **Effect:** Words instantly highlight in accent color
- **Best For:** High-energy content, Gen Z audience
- **Example:** `{\c&H00FFFF&}highlighted`

### Pop

- **Effect:** Words bounce in with scale animation (50% → 115% → 100%)
- **Best For:** High energy, Gen Z, TikTok content
- **Duration:** 180ms (normal speed)

### Bounce

- **Effect:** Words bounce up from below frame
- **Best For:** Emphasis, key moments
- **Duration:** 280ms with overshoot

### Typewriter

- **Effect:** Characters appear one at a time
- **Best For:** Storytelling, dramatic reveals
- **Speed:** 100ms per character (normal)

### Scale Pulse

- **Effect:** Words pulse larger on appear
- **Best For:** Emphasis on key words
- **Emphasis:** 125% scale vs 110% normal

## Color Schemes

| Scheme       | Primary | Highlight | Best For                    |
| ------------ | ------- | --------- | --------------------------- |
| Gaming       | Yellow  | Red       | Gaming content, high energy |
| Professional | White   | Gold      | Educational, business       |
| Lifestyle    | White   | Pink      | Aesthetic, vlogs            |
| Comedy       | White   | Green     | Casual, humor               |

## Platform Presets

### TikTok Viral

- Font: Arial Black, 84px
- Position: Lower third (300px from bottom)
- Outline: 6px black
- Animation: Fast pop

### YouTube Shorts Pro

- Font: Montserrat, 72px
- Position: Lower third (280px)
- Outline: 4px dark gray
- Animation: Normal karaoke

### Instagram Reels

- Font: Impact, 80px
- Position: Lower third (260px)
- Outline: 5px black
- Animation: Bounce

## Best Practices

1. **Keep it readable:** Max 3-5 words per screen
2. **Timing matters:** Match animation speed to content pace
3. **Contrast is key:** Ensure text stands out from background
4. **Emoji sparingly:** Use for emphasis, not every word
5. **Platform optimization:** Use presets for each platform
```

### 5.2 Developer Notes

**Update:** `backend/pipeline/README.md`

**Add Section:**

```markdown
## ASS Animation Tags Reference

### Timing Units

- **\t() animations:** MILLISECONDS (e.g., `\t(0,180,...)` = 0-180ms)
- **\k karaoke:** CENTISECONDS (e.g., `\k50` = 0.50 seconds)
- **Dialogue timestamps:** H:MM:SS.cc (centiseconds)

### Common Tags

| Tag                       | Description                      | Example                   |
| ------------------------- | -------------------------------- | ------------------------- |
| `\fscxN`                  | Scale X by N%                    | `\fscx50` = 50% width     |
| `\fscyN`                  | Scale Y by N%                    | `\fscy115` = 115% height  |
| `\t(start,end,transform)` | Animate from start to end ms     | `\t(0,100,\fscx100)`      |
| `\move(x1,y1,x2,y2)`      | Move from (x1,y1) to (x2,y2)     | `\move(540,1100,540,960)` |
| `\kfN`                    | Karaoke fill over N centiseconds | `\kf50` = 0.5s fill       |
| `\c&HXXXXXX&`             | Change primary color             | `\c&H00FFFF&` = yellow    |
| `\fad(in,out)`            | Fade in/out over ms              | `\fad(200,0)`             |
| `\pos(x,y)`               | Position at coordinates          | `\pos(540,960)`           |
| `\fnFontName`             | Change font                      | `\fnSegoe UI Emoji`       |

### Font Compatibility

- **Container fonts:** Ensure fonts are installed in Docker container
- **Fallback chain:** Specify fallback in ASS header
- **Emoji fonts:** Segoe UI Emoji (Windows), Apple Color Emoji (macOS)

### Performance Considerations

- **Typewriter effect:** Creates N Dialogue lines per word (N = characters)
- **File size:** Complex animations increase ASS file size 2-5x
- **Render time:** +10-20% for pop/bounce, +50% for typewriter
- **Recommendation:** Limit typewriter to clips <10 seconds
```

---

## Implementation Timeline

### Week 1: Core Animation Styles

- [ ] 1.1: Implement pop animation
- [ ] 1.2: Implement bounce animation
- [ ] 1.3: Update `_build_ass_word_by_word` with style switching
- [ ] Test: Verify ASS output for both styles

### Week 2: Advanced Animations & Presets

- [ ] 1.4: Implement typewriter animation
- [ ] 1.5: Implement scale pulse animation
- [ ] 1.6: Add style presets (TikTok, YouTube, etc.)
- [ ] Test: All 6 animation styles render correctly

### Week 3: Emoji & Color Schemes

- [ ] 2.1: Add emoji dependency
- [ ] 2.2: Implement emoji detection and font switching
- [ ] 2.3: Add color scheme presets
- [ ] Test: Emoji rendering across platforms

### Week 4: Frontend UI

- [ ] 3.1: Update ClipSectionSubtitles.tsx with new controls
- [ ] 3.2: Update API types
- [ ] 3.3: Integrate with TimelineToolbar
- [ ] Test: UI interactions and state management

### Week 5: Testing & Polish

- [ ] 4.1: Write backend unit tests
- [ ] 4.2: Write frontend component tests
- [ ] 4.3: Integration tests for all styles
- [ ] Bug fixes and performance optimization

### Week 6: Documentation & Launch

- [ ] 5.1: Write user guide
- [ ] 5.2: Update developer docs
- [ ] 5.3: Create example videos
- [ ] Deploy to production

---

## Success Metrics

- [ ] ✅ All 6 animation styles render correctly in FFmpeg
- [ ] ✅ Emoji support works across Windows/macOS/Linux
- [ ] ✅ Color schemes apply correct ASS color codes
- [ ] ✅ Platform presets configure all settings appropriately
- [ ] ✅ UI is intuitive (user testing feedback)
- [ ] ✅ No regression in existing karaoke/capcut modes
- [ ] ✅ Render time increase <20% for pop/bounce animations
- [ ] ✅ ASS file size increase <50% for typical clips
- [ ] ✅ 25%+ increase in clip engagement (post-launch metric)

---

## Technical Debt & Future Enhancements

### Known Limitations

1. **Font Dependencies:** Requires fonts in container
   - **Solution:** Add fonts directory mount or install in Dockerfile

2. **Emoji Platform Variance:** Different emoji sets per OS
   - **Solution:** Bundle emoji font or use image overlays

3. **Typewriter Performance:** Slow for long clips
   - **Solution:** Auto-disable for clips >10s or add warning

### Future Enhancements

1. **Custom Animation Builder:** UI to create custom `\t()` sequences
2. **Animation Presets Marketplace:** User-shared animation configs
3. **Auto-Emphasis Detection:** LLM identifies words to emphasize
4. **Multi-Language Support:** RTL text, CJK font handling
5. **Real-time Preview:** FFmpeg wasm for browser preview

---

## Appendix: Example ASS Output

### Pop Style Example

```ass
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial Black,80,&H00FFFFFF,&H0000FFFF,&H00000000,&H40000000,1,0,0,0,100,100,0,0,1,5,0,2,10,10,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:00.50,Default,,0,0,0,,{\fad(200,0)\fscx50\fscy50\t(0,80,\fscx115\fscy115)\t(80,180,\fscx100\fscy100)}This
Dialogue: 0,0:00:00.30,0:00:00.80,Default,,0,0,0,,{\fad(200,0)\fscx50\fscy50\t(0,80,\fscx115\fscy115)\t(80,180,\fscx100\fscy100)}is
Dialogue: 0,0:00:00.50,0:00:01.20,Default,,0,0,0,,{\fad(200,0)\c&H00FFFF&\fscx50\fscy50\t(0,80,\fscx120\fscy120)\t(80,180,\fscx100\fscy100)}AMAZING
```

### Bounce Style Example

```ass
Dialogue: 0,0:00:00.00,0:00:00.80,Default,,0,0,0,,{\fad(200,0)\move(540,1100,540,960)\t(0,120,\fscx115\fscy115)\t(120,200,\fscx95\fscy95)\t(200,280,\fscx100\fscy100)}Word
```

### Typewriter Style Example

```ass
Dialogue: 0,0:00:00.00,0:00:00.10,Typewriter,,0,0,0,,T
Dialogue: 0,0:00:00.10,0:00:00.20,Typewriter,,0,0,0,,Th
Dialogue: 0,0:00:00.20,0:00:00.30,Typewriter,,0,0,0,,Thi
Dialogue: 0,0:00:00.30,0:00:00.40,Typewriter,,0,0,0,,This
```

---

_Document Version: 1.0_  
_Last Updated: 2025-05-07_  
_Author: Development Team_
