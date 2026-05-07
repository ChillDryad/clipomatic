# UI Wireframes - CapCut Animated Captions

## Overview

This document contains ASCII wireframes for the enhanced subtitle configuration UI components described in `capcut-animated-captions.md`.

---

## 1. Animation Style Selector

**Location:** `ClipSectionSubtitles.tsx`  
**Purpose:** Select one of 6 caption animation styles  
**Layout:** 3-column grid with visual feedback

```
┌─────────────────────────────────────────────────────────────┐
│  Animation Style                                            │
│  ════════════════════════════════════════════════════════  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │  Karaoke        │  │  CapCut         │  │  Pop        │ │
│  │  Sweep fill     │  │  Solid highlight│  │  Word bounce│ │
│  │                 │  │                 │  │             │ │
│  │  [░░░░░░░░░░]   │  │  [██████████]   │  │  [○ → ●]    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │  Bounce         │  │  Typewriter     │  │  Pulse      │ │
│  │  From below     │  │  Char reveal    │  │  Scale emp. │ │
│  │                 │  │                 │  │             │ │
│  │  [↑ ○]          │  │  [T][T→Th]      │  │  [○ → ◎]    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘

Legend:
  - Selected state: Bold border + highlighted background
  - Hover state: Lighter border
  - Each card: 120px × 80px
  - Icon area: 40×40px centered
```

### Interaction States

```
DEFAULT STATE:
┌─────────────────┐
│  Pop            │  ← Border: var(--ctp-overlay)
│  Word bounce    │  ← Background: transparent
│                 │
│  [○ → ●]        │
└─────────────────┘

SELECTED STATE:
┌─────────────────┐
│  Pop            │  ← Border: var(--ctp-mauve) [2px]
│  Word bounce    │  ← Background: var(--ctp-surface-2)
│                 │
│  [○ → ●]        │
└─────────────────┘

HOVER STATE:
┌─────────────────┐
│  Pop            │  ← Border: var(--ctp-subtext)
│  Word bounce    │  ← Background: var(--ctp-surface-1)
│                 │
│  [○ → ●]        │
└─────────────────┘
```

---

## 2. Animation Speed Selector

**Location:** `ClipSectionSubtitles.tsx` (below animation style)  
**Purpose:** Select animation playback speed  
**Layout:** Horizontal button group

```
┌─────────────────────────────────────────────────────────────┐
│  Animation Speed                                            │
│  ════════════════════════════════════════════════════════  │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │  Fast    │  │  Normal  │  │  Slow    │                  │
│  │  120ms   │  │  180ms   │  │  250ms   │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│       ↑              ↑              ↑                        │
│   Unselected    Selected      Unselected                    │
│   (gray)        (mauve)       (gray)                        │
└─────────────────────────────────────────────────────────────┘

Detailed State Representation:

UNSELECTED BUTTON:
┌──────────┐
│  Fast    │  ← Background: var(--ctp-surface-1)
│  120ms   │  ← Text: var(--ctp-subtext)
└──────────┘  ← Border: none
   80×40px

SELECTED BUTTON:
┌──────────┐
│  Normal  │  ← Background: var(--ctp-mauve)
│  180ms   │  ← Text: var(--ctp-base) [white]
└──────────┘  ← Border: none
   80×40px
```

---

## 3. Color Scheme Selector

**Location:** `ClipSectionSubtitles.tsx`  
**Purpose:** Choose from 4 preset color palettes  
**Layout:** 2-column grid with color preview swatches

```
┌─────────────────────────────────────────────────────────────┐
│  Color Scheme                                               │
│  ════════════════════════════════════════════════════════  │
│                                                             │
│  ┌────────────────────────────┐  ┌───────────────────────┐ │
│  │  ● ●  Gaming              │  │  ● ●  Professional    │ │
│  │  ○ ○  Yellow/Red          │  │  ○ ○  White/Gold      │ │
│  └────────────────────────────┘  └───────────────────────┘ │
│       ↑ Selected                          ↑ Unselected      │
│                                                             │
│  ┌────────────────────────────┐  ┌───────────────────────┐ │
│  │  ● ●  Lifestyle            │  │  ● ●  Comedy          │ │
│  │  ○ ○  White/Pink           │  │  ○ ○  White/Green     │ │
│  └────────────────────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

Color Swatch Detail (zoomed in):

SELECTED CARD:
┌────────────────────────────┐
│  ┌──┐ ┌──┐  Gaming         │  ← Border: var(--ctp-mauve)
│  │██│ │██│  High energy    │  ← Background: var(--ctp-surface-2)
│  └──┘ └──┘                 │
│  Yellow  Red               │
└────────────────────────────┘
   ↑    ↑
   │    └─ Highlight color (16×16px circle)
   └──── Primary color (16×16px circle)
        Overlap: -4px (space-x-1)

UNSELECTED CARD:
┌────────────────────────────┐
│  ┌──┐ ┌──┐  Professional   │  ← Border: var(--ctp-overlay)
│  │██│ │██│  Educational    │  ← Background: transparent
│  └──┘ └──┘                 │
│  White  Gold               │
└────────────────────────────┘
```

### Color Swatch Specifications

```
SWATCH CONTAINER:
- Size: 16×16px circle
- Border: 1px solid var(--ctp-base)
- Overlap: -4px horizontal margin
- Position: Left side of card

COLOR MAPPING:
┌─────────────┬──────────────┬──────────────┬─────────────────┐
│ Scheme      │ Primary      │ Highlight    │ Description     │
├─────────────┼──────────────┼──────────────┼─────────────────┤
│ Gaming      │ #FFFF00 (Y)  │ #FF0000 (R)  │ High energy     │
│ Professional│ #FFFFFF (W)  │ #FFD700 (G)  │ Educational     │
│ Lifestyle   │ #FFFFFF (W)  │ #FFC0CB (P)  │ Aesthetic       │
│ Comedy      │ #FFFFFF (W)  │ #00FF00 (G)  │ Casual          │
└─────────────┴──────────────┴──────────────┴─────────────────┘
```

---

## 4. Emoji Support Toggle

**Location:** `ClipSectionSubtitles.tsx` (inline setting)  
**Purpose:** Enable/disable emoji font switching  
**Layout:** Toggle switch with label and description

```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Emoji Support                          ┌─────────┐   │  │
│  │  Render emojis with proper font         │  ●    │   │  │
│  │                                         └─────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
│         ↑ Label/description              ↑ Toggle (ON)       │
└─────────────────────────────────────────────────────────────┘

TOGGLE STATES:

ON STATE:
┌─────────────────┐
│      ●          │  ← Background: var(--ctp-mauve)
│  ◯───────┘      │  ← Knob: white circle, left: 20px (left-5)
└─────────────────┘
   40×20px

OFF STATE:
┌─────────────────┐
│          ●      │  ← Background: var(--ctp-overlay)
│  └───────◯      │  ← Knob: white circle, left: 2px (left-0.5)
└─────────────────┘
   40×20px

TOGGLE SPECIFICATIONS:
- Container: 40×20px rounded-full
- Knob: 16×16px (w-4 h-4) white circle
- Padding: 2px (top-0.5, left-0.5)
- Transition: CSS transition on all properties
- ON position: left-5 (20px)
- OFF position: left-0.5 (2px)
```

---

## 5. Platform Preset Selector

**Location:** `ClipSectionSubtitles.tsx`  
**Purpose:** Apply platform-specific configuration presets  
**Layout:** 2-column grid with "Apply" button

```
┌─────────────────────────────────────────────────────────────┐
│  Platform Preset                                            │
│  ════════════════════════════════════════════════════════  │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │  TikTok             │  │  YouTube            │          │
│  │  84px, Arial Black  │  │  72px, Montserrat   │          │
│  └─────────────────────┘  └─────────────────────┘          │
│       ↑ Selected                        ↑ Unselected        │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │  Instagram          │  │  Facebook           │          │
│  │  80px, Impact       │  │  72px, Clear        │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Apply TikTok Settings                      │    │
│  │         (enabled when a preset is selected)        │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

CARD STATES:

SELECTED CARD:
┌─────────────────────┐
│  TikTok             │  ← Border: var(--ctp-mauve) [2px]
│  84px, Arial Black  │  ← Background: var(--ctp-surface-2)
│                     │
│  [TikTok icon]      │  ← Optional: platform logo 24×24px
└─────────────────────┘
   140×70px

UNSELECTED CARD:
┌─────────────────────┐
│  YouTube            │  ← Border: var(--ctp-overlay)
│  72px, Montserrat   │  ← Background: transparent
│                     │
│  [YouTube icon]     │
└─────────────────────┘
   140×70px

APPLY BUTTON:
┌────────────────────────────────────────────────────┐
│         Apply TikTok Settings                      │  ← Enabled
│         (secondary button style)                   │
└────────────────────────────────────────────────────┘

DISABLED APPLY BUTTON (no selection):
┌────────────────────────────────────────────────────┐
│         Apply Preset                               │  ← Disabled
│         (opacity: 0.5, pointer-events: none)       │
└────────────────────────────────────────────────────┘
```

---

## 6. Complete Settings Panel Layout

**Full vertical stack showing all components together:**

```
┌─────────────────────────────────────────────────────────────┐
│  SUBTITLE SETTINGS                                          │
│  ════════════════════════════════════════════════════════  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Caption Style                                       │   │
│  │  ════════════════════════════════════════════════   │   │
│  │  [Karaoke] [CapCut] [Pop] [Bounce] [Typewriter]...  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Animation Speed                                     │   │
│  │  ════════════════════════════════════════════════   │   │
│  │  [Fast] [Normal] [Slow]                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Color Scheme                                        │   │
│  │  ════════════════════════════════════════════════   │   │
│  │  [Gaming]      [Professional]                       │   │
│  │  [Lifestyle]   [Comedy]                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Emoji Support                          ┌─────────┐  │   │
│  │  Render emojis with proper font         │  ●    │  │   │
│  └─────────────────────────────────────────┘         └──┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Platform Preset                                     │   │
│  │  ════════════════════════════════════════════════   │   │
│  │  [TikTok]      [YouTube]                            │   │
│  │  [Instagram]   [Facebook]                           │   │
│  │  [Apply TikTok Settings]                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ───────────────────────────────────────────────────────    │
│                                                             │
│  [Existing Settings Continue...]                            │
│  • Font Family: [Arial Black ▼]                            │
│  • Font Size: [84] ───────○──────── 100px                  │
│  • Words per Line: [2] ───○────── 4                         │
│  • Font Color: [#FFFFFF]  Highlight: [#FFFF00]             │
│                                                             │
└─────────────────────────────────────────────────────────────┘

LAYOUT SPECIFICATIONS:
- Panel width: 400px (standard settings panel)
- Section spacing: 24px vertical gap
- Label font: 12px, medium weight, var(--ctp-text)
- Description text: 10px, var(--ctp-subtext)
- Card gap: 8px (gap-2)
- Border radius: 6px (rounded)
```

---

## 7. Timeline Toolbar Integration

**Location:** `TimelineToolbar.tsx` - Quick render settings dropdown

```
┌─────────────────────────────────────────────────────────────┐
│  RENDER SETTINGS                                    [▼]    │
│  ═══════════════════════════════════════════════════════   │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Font Size: 84px                                   │    │
│  │  Words/Line: 2                                     │    │
│  │  Quality: Production                               │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ───────────────────────────────────────────────────────    │
│                                                             │
│  Animation: [Karaoke ▼]                                     │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │  ○ Karaoke         ○ Pop                           │    │
│  │  ○ CapCut          ○ Bounce                        │    │
│  │  ○ Typewriter      ○ Pulse                         │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  Speed: [Fast] [Normal] [Slow]                             │
│                                                             │
│  Colors: [Gaming ▼]                                        │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │  [Render Clip]                                      │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

DROPDOWN EXPANSION:
- Compact view: Single select for each category
- Expanded view: Grid of all options (shown above)
- Width: 320px
- Max height: 400px (scrollable if needed)
```

---

## 8. State Management Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  COMPONENT STATE (ClipSectionSubtitles)                    │
│  ════════════════════════════════════════════════════════  │
│                                                             │
│  const [animationStyle, setAnimationStyle] = "karaoke"     │
│  const [animationSpeed, setAnimationSpeed] = "normal"      │
│  const [colorScheme, setColorScheme] = "professional"      │
│  const [enableEmoji, setEnableEmoji] = true                │
│  const [platformPreset, setPlatformPreset] = null          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  User clicks "Pop" button                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  setAnimationStyle("pop")                           │   │
│  │  update({ animationStyle: "pop" })                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Parent component receives update                   │   │
│  │  Merges into clip settings                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  API Call (renderClip)                              │   │
│  │  {                                                  │   │
│  │    caption_style: "pop",                            │   │
│  │    animation_speed: "normal",                       │   │
│  │    color_scheme: "professional",                    │   │
│  │    enable_emoji: true,                              │   │
│  │    platform_preset: null                            │   │
│  │  }                                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Backend (renderer.py)                              │   │
│  │  _build_ass_word_by_word(...,                       │   │
│  │    caption_style="pop",                             │   │
│  │    animation_speed="normal")                        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Responsive Behavior

### Desktop (≥1024px)

```
┌────────────────────────────────────────────────┐
│  [Animation Style Grid - 3 columns]           │
│  [Color Scheme Grid - 2 columns]              │
│  [Platform Preset Grid - 2 columns]           │
└────────────────────────────────────────────────┘
```

### Tablet (768px - 1023px)

```
┌────────────────────────────────────────────────┐
│  [Animation Style Grid - 2 columns]           │
│  [Color Scheme Grid - 2 columns]              │
│  [Platform Preset Grid - 2 columns]           │
└────────────────────────────────────────────────┘
```

### Mobile (<768px)

```
┌────────────────────────────────────────────────┐
│  [Animation Style - Vertical Stack]           │
│  [Color Scheme - Vertical Stack]              │
│  [Platform Preset - Vertical Stack]           │
└────────────────────────────────────────────────┘
```

---

## 10. Accessibility Notes

### Keyboard Navigation

```
TAB ORDER:
1. Animation Style cards (left→right, top→bottom)
2. Animation Speed buttons (left→right)
3. Color Scheme cards (left→right, top→bottom)
4. Emoji toggle
5. Platform Preset cards (left→right, top→bottom)
6. Apply button

ARROW KEY NAVIGATION (within groups):
- Arrow Right/Down: Next option
- Arrow Left/Up: Previous option
- Enter/Space: Select option
- Escape: Deselect (if allowed)
```

### Screen Reader Labels

```
Animation Style card:
  "Pop animation style, Word bounce effect, button"

Animation Speed button:
  "Normal speed, 180 milliseconds, selected"

Color Scheme card:
  "Gaming color scheme, Yellow and Red colors, button"

Emoji toggle:
  "Emoji support, Render emojis with proper font, toggle button, checked"

Platform Preset card:
  "TikTok platform preset, 84 pixels Arial Black font, button"
```

### Focus Indicators

```
FOCUS RING:
- Width: 2px
- Color: var(--ctp-mauve)
- Style: solid
- Offset: 2px outside element

EXAMPLE:
┌─────────────────┐
│  ╔═══════════╗  │  ← Outer ring (mauve)
│  ║  Pop      ║  │
│  ║  [○ → ●]  ║  │  ← Inner border (mauve if selected)
│  ╚═══════════╝  │
└─────────────────┘
```

---

## 11. Design Token Mapping — Neon Sakura Theme

### Dark Theme (Primary)

```css
/* Brand Colors */
--momiji-sakura: #ffb7c5; /* Primary actions, selection */
--momiji-neon-pink: #ff69b4; /* Hover states, glows */
--momiji-red: #b40829; /* Destructive, urgency */
--momiji-plant: #2d5016; /* Success, growth */
--momiji-neon-green: #00ff9d; /* Cyber accents, active states */

/* Base Colors */
--momiji-bg: #1a1a2e; /* Main background */
--momiji-surface: #252542; /* Cards, panels */
--momiji-surface-light: #3a3a5c; /* Elevated surfaces */
--momiji-text: #f0e6ef; /* Primary text */
--momiji-subtext: #c9b8c8; /* Secondary text */
--momiji-border: #4a4a6a; /* Dividers, borders */

/* Glass Effects */
--glass-bg: rgba(37, 37, 66, 0.75);
--glass-border: rgba(255, 183, 197, 0.18);
--glass-blur: blur(16px) saturate(180%);

/* Gradients */
--gradient-momiji: linear-gradient(135deg, #ffb7c5 0%, #ff69b4 100%);
--gradient-neon: linear-gradient(135deg, #ff69b4 0%, #00ff9d 100%);

/* Glow Effects */
--glow-sakura: 0 0 20px rgba(255, 183, 197, 0.5);
--glow-neon: 0 0 20px rgba(0, 255, 157, 0.5);
```

### Component Mapping

```css
/* Animation Style Cards */
.card-selected {
  border: 2px solid var(--momiji-sakura);
  background: var(--momiji-surface);
  box-shadow: var(--glow-sakura);
}

.card-unselected {
  border: 1px solid var(--momiji-border);
  background: transparent;
}

.card-hover {
  border-color: var(--momiji-subtext);
  background: var(--momiji-surface-light);
}

/* Animation Speed Buttons */
.speed-selected {
  background: var(--gradient-momiji);
  color: var(--momiji-bg);
  font-weight: 600;
}

.speed-unselected {
  background: var(--momiji-surface);
  color: var(--momiji-subtext);
}

/* Color Scheme Swatches */
.swatch-border {
  border: 1px solid var(--momiji-text);
}

/* Emoji Toggle */
.toggle-on {
  background: var(--momiji-sakura);
}

.toggle-off {
  background: var(--momiji-border);
}

.toggle-knob {
  background: var(--momiji-text);
}

/* Platform Preset Cards */
.preset-selected {
  border: 2px solid var(--momiji-sakura);
  background: var(--momiji-surface);
}

.preset-unselected {
  border: 1px solid var(--momiji-border);
}

/* Apply Button */
.btn-apply {
  background: var(--gradient-momiji);
  color: var(--momiji-bg);
  border-radius: 9999px;
  font-weight: 600;
}

.btn-apply:hover {
  box-shadow: var(--glow-sakura);
}

/* Section Labels */
.label-primary {
  color: var(--momiji-text);
  font-weight: 600;
}

.label-description {
  color: var(--momiji-subtext);
}

/* Focus Ring */
.focus-ring {
  outline: 2px solid var(--momiji-sakura);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(255, 183, 197, 0.2);
}
```

### Visual Reference

```
┌─────────────────────────────────────────────────────────────┐
│  NEON SAKURA PALETTE                                        │
│  ════════════════════════════════════════════════════════   │
│                                                             │
│  #ffb7c5  MOMIJI SAKURA      ████  Primary selection       │
│  #ff69b4  MOMIJI NEON PINK    ████  Hover, gradients       │
│  #00ff9d  MOMIJI NEON GREEN   ████  Cyber accents          │
│  #252542  MOMIJI SURFACE      ████  Card backgrounds       │
│  #f0e6ef  MOMIJI TEXT         ████  Primary text           │
│  #c9b8c8  MOMIJI SUBTEXT      ████  Secondary text         │
│  #4a4a6a  MOMIJI BORDER       ████  Borders, dividers      │
└─────────────────────────────────────────────────────────────┘
```

---

_Document Version: 1.0_  
_Created: 2026-05-07_  
_Purpose: UI implementation reference for CapCut animated captions feature_
