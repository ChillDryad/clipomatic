# Momiji Clipper — UI/UX Design Specification

**Version:** 1.0  
**Date:** 2026-05-04  
**Theme:** "Neon Sakura" — A blend of cyberpunk neon and cozy sakura/plant aesthetics

---

## 1. Brand Identity

### Momiji Yoru's Persona
| Attribute | Description |
|-----------|-------------|
| **Oshi Mark** | 🌸🎮 (Cherry Blossom + Game Controller) |
| **Lore** | "Bathed in neon and a collection of house plants" — an elf-ish character making a new home in a strange city |
| **Personality** | Cozy with a "spicy kernel" underneath |
| **Content** | Coding, Free Talk, Gaming |
| **Location** | Canada 🇨🇦 |

### Design Pillars
1. **Neon City Nights** — Deep purples, electric pinks, cyber greens
2. **Cozy Garden** — Warm sakura pinks, soft plant greens, comfortable surfaces
3. **Playful Tech** — Fun micro-interactions, themed loading states, personality in microcopy

---

## 2. Color System: "Neon Sakura"

### Primary Brand Colors

```
┌─────────────────────────────────────────────────────────────┐
│  MOMIJI SAKURA         #ffb7c5  ████  Primary actions     │
│  MOMIJI NEON PINK      #ff69b4  ████  Hover states, glows │
│  MOMIJI BRAND RED      #b40829  ████  Destructive, urgency│
│  MOMIJI PLANT GREEN    #2d5016  ████  Success, growth     │
│  MOMIJI NEON GREEN     #00ff9d  ████  Cyber accents       │
└─────────────────────────────────────────────────────────────┘
```

### Base Palette (Dark Theme)

```
┌─────────────────────────────────────────────────────────────┐
│  COZY BG              #1a1a2e  ████  Main background      │
│  SURFACE              #252542  ████  Cards, panels        │
│  SURFACE-LIGHT        #3a3a5c  ████  Elevated surfaces    │
│  TEXT                 #f0e6ef  ████  Primary text         │
│  SUBTEXT              #c9b8c8  ████  Secondary text       │
│  BORDER               #4a4a6a  ████  Dividers, borders    │
└─────────────────────────────────────────────────────────────┘
```

### Base Palette (Light Theme)

```
┌─────────────────────────────────────────────────────────────┐
│  COZY BG              #f5f0f4  ████  Main background      │
│  SURFACE              #e8e0e6  ████  Cards, panels        │
│  SURFACE-LIGHT        #d9d0d8  ████  Elevated surfaces    │
│  TEXT                 #2d2a32  ████  Primary text         │
│  SUBTEXT              #5a5560  ████  Secondary text       │
│  BORDER               #c9b8c8  ████  Dividers, borders    │
└─────────────────────────────────────────────────────────────┘
```

### Semantic Colors

| State | Dark Theme | Light Theme | Usage |
|-------|------------|-------------|-------|
| Success | `#00ff9d` | `#2d5016` | Completed states, positive feedback |
| Error | `#ff6b9d` | `#b40829` | Errors, destructive actions |
| Warning | `#ffcc00` | `#df8e1d` | Warnings, caution states |
| Info | `#00d4ff` | `#04a5e5` | Information, neutral feedback |
| Primary | `#ffb7c5` | `#ff69b4` | Primary actions, links |

### Gradient Definitions

```css
/* Primary button gradient */
--gradient-momiji: linear-gradient(135deg, #ffb7c5 0%, #ff69b4 100%);

/* Neon glow overlay */
--gradient-neon: linear-gradient(135deg, #ff69b4 0%, #00ff9d 100%);

/* Ambient background (dark) */
--gradient-ambient-dark: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255, 105, 180, 0.15), transparent 70%);

/* Ambient background (light) */
--gradient-ambient-light: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255, 183, 197, 0.20), transparent 70%);
```

---

## 3. Typography

### Font Stack
```css
--font-sans: 'Outfit', 'Inter', ui-sans-serif, system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
```

### Type Scale

```
┌─────────────────────────────────────────────────────────────┐
│  HERO          2.5rem  (40px)   Font-weight: 800           │
│  TITLE         1.75rem (28px)   Font-weight: 700           │
│  HEADING       1.25rem (20px)   Font-weight: 600           │
│  BODY          0.875rem (14px)  Font-weight: 400           │
│  CAPTION       0.75rem (12px)   Font-weight: 400           │
│  MICRO         0.625rem (10px)  Font-weight: 500           │
└─────────────────────────────────────────────────────────────┘
```

### Text Treatments

```tsx
// Gradient text for logo/hero
.text-gradient-momiji {
  background: linear-gradient(135deg, #ffb7c5, #ff69b4);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

// Neon glow for important text
.text-neon-glow {
  text-shadow: 0 0 20px rgba(255, 105, 180, 0.5);
}
```

---

## 4. Component Specifications

### 4.1 Logo Component

**Current:**
```
┌────────────────────────────┐
│  Momiji Clipper            │
└────────────────────────────┘
```

**New Design:**
```
┌─────────────────────────────────────────┐
│  🌸 Momiji Clipper                      │
│     ╰─ Sakura icon + gradient text      │
└─────────────────────────────────────────┘
```

**Implementation:**
```tsx
<Link to="/" className="flex items-center gap-2 group">
  {/* Animated Sakura Leaf */}
  <div className="relative w-6 h-6">
    <svg className="w-6 h-6 text-[var(--momiji-sakura)] animate-pulse-slow" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C9.5 2 7 4.5 7 7c0 1.5.5 2.5 1.5 3.5C7 11.5 4 14 4 17c0 2.5 2 4 4.5 4S13 19.5 13 17c0-1-.5-2-1-2.5 1 .5 2.5.5 3.5 0C15 15 14.5 16 14.5 17c0 2.5 2 4 4.5 4s4.5-1.5 4.5-4c0-3-3-5.5-4.5-6.5C20 9.5 20.5 8.5 20.5 7c0-2.5-2.5-5-5-5S13 4.5 13 7c0 1 .5 2 1 2.5-1-.5-2.5-.5-3.5 0C11 9 11.5 8 11.5 7c0-2.5-2-5-4.5-5z"/>
    </svg>
    <div className="absolute inset-0 bg-[var(--momiji-sakura)] blur-md opacity-30 group-hover:opacity-60 transition-opacity" />
  </div>
  
  {/* Gradient Wordmark */}
  <span className="text-lg font-bold text-gradient-momiji">
    Momiji Clipper
  </span>
</Link>
```

---

### 4.2 Glass Card Variants

**Current:** Single `.glass-card` class

**New:** Three variants for hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│  ELEVATED    │  Standard    │  Subtle                       │
│  ════════    │  ════════    │  ════════                     │
│  ┏━━━━━━┓    │  ┏━━━━━━┓    │  ┌──────┐                     │
│  ┃ Glow ┃    │  ┃ Solid┃    │  │ Light│                     │
│  ┗━━━━━━┛    │  ┗━━━━━━┛    │  └──────┘                     │
│  Hero cards  │  Main cards  │  Secondary                    │
└─────────────────────────────────────────────────────────────┘
```

**CSS:**
```css
/* Elevated — for hero cards, featured content */
.glass-card-elevated {
  background: rgba(37, 37, 66, 0.8);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 183, 197, 0.3);
  border-radius: 16px;
  box-shadow: 
    0 20px 60px rgba(180, 8, 41, 0.15),
    0 0 40px rgba(255, 105, 180, 0.1);
}

/* Standard — main content cards */
.glass-card {
  background: rgba(37, 37, 66, 0.7);
  backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(255, 183, 197, 0.15);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

/* Subtle — secondary content, nested panels */
.glass-card-subtle {
  background: rgba(37, 37, 66, 0.5);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 183, 197, 0.08);
  border-radius: 12px;
}
```

---

### 4.3 Button System

**Variants:**

```
┌─────────────────────────────────────────────────────────────┐
│  PRIMARY (Momiji Gradient)                                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│  [  Render Clip  ]  ← Gradient: Sakura → Neon Pink          │
│                                                             │
│  SECONDARY (Surface)                                        │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│  [  Edit Clip  ]   ← Surface color with border              │
│                                                             │
│  NEON (Cyber Accent) — NEW                                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│  [  ✨ Enhance  ]  ← Neon green border + glow               │
│                                                             │
│  GHOST (Transparent)                                        │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│  [  Cancel  ]     ← Transparent, hover fill                 │
└─────────────────────────────────────────────────────────────┘
```

**CSS:**
```css
/* Primary — gradient with hover glow */
.btn-momiji-primary {
  background: linear-gradient(135deg, #ffb7c5 0%, #ff69b4 100%);
  color: #1a1a2e;
  border: none;
  border-radius: 9999px;
  padding: 0.5rem 1rem;
  font-weight: 600;
  position: relative;
  overflow: hidden;
}

.btn-momiji-primary::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #ff69b4, #00ff9d);
  opacity: 0;
  transition: opacity 0.2s;
}

.btn-momiji-primary:hover::after {
  opacity: 0.3;
}

/* Neon — cyber accent button */
.btn-momiji-neon {
  background: transparent;
  border: 2px solid #00ff9d;
  color: #00ff9d;
  border-radius: 9999px;
  padding: 0.5rem 1rem;
  font-weight: 600;
  box-shadow: 0 0 10px rgba(0, 255, 157, 0.2);
  transition: all 0.2s;
}

.btn-momiji-neon:hover {
  background: rgba(0, 255, 157, 0.1);
  box-shadow: 0 0 20px rgba(0, 255, 157, 0.4);
}
```

---

### 4.4 Progress Bar (Themed)

**Current:** Generic shimmer gradient

**New:** "Sakura Stream" animation

```
┌─────────────────────────────────────────────────────────────┐
│  Transcribing...                                    67%     │
│  ╔════════════════════════════════════════════════════╗     │
│  ║▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░║     │
│  ║  ╰─ Gradient: Sakura → Neon Pink                  ║     │
│  ║      with falling petal particles                  ║     │
│  ╚════════════════════════════════════════════════════╝     │
└─────────────────────────────────────────────────────────────┘
```

**CSS:**
```css
.glass-progress-track {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: rgba(58, 58, 92, 0.5);
  overflow: hidden;
  position: relative;
}

.glass-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #ffb7c5 0%, #ff69b4 50%, #00ff9d 100%);
  background-size: 200% 100%;
  animation: shimmerGradient 2s linear infinite;
  position: relative;
}

/* Falling sakura petals */
.glass-progress-fill::before {
  content: '';
  position: absolute;
  top: -4px;
  right: 0;
  width: 8px;
  height: 8px;
  background: #ffb7c5;
  border-radius: 50% 0 50% 0;
  animation: petal-fall 1s ease-out infinite;
}

@keyframes petal-fall {
  0% { transform: translateY(0) rotate(0deg); opacity: 1; }
  100% { transform: translateY(20px) rotate(180deg); opacity: 0; }
}
```

---

### 4.5 Empty States

**Current:**
```
┌─────────────────────────────────┐
│  No videos yet. Start a project │
│  above!                         │
└─────────────────────────────────┘
```

**New: "Clip Garden" Metaphor**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                        🌸                                   │
│                                                             │
│              Your clip garden is empty                      │
│                                                             │
│         Upload a VOD to start growing your                  │
│              momiji moments 🍁                              │
│                                                             │
│              [  📥 Upload Video  ]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
```tsx
<div className="glass-card-subtle p-8 text-center">
  <div className="text-5xl mb-4 animate-bounce-slow">🌸</div>
  <h3 className="text-momiji-heading text-[var(--momiji-text)]">
    Your clip garden is empty
  </h3>
  <p className="text-momiji-body text-[var(--momiji-subtext)] mt-2">
    Upload a VOD to start growing your momiji moments 🍁
  </p>
  <div className="mt-6">
    <Link to="/pipeline" className="btn-momiji-primary">
      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      Upload Video
    </Link>
  </div>
</div>
```

---

### 4.6 Clip Card (Virality Visual)

**Current:** Simple colored left border

**New:** "Bloom Score" — Virality shown as blooming flower

```
┌─────────────────────────────────────────────────────────────┐
│  HIGH (80-100)        MID (50-79)        LOW (0-49)        │
│  ═══════════          ═══════════        ═══════════        │
│  ┏━━━━━━━━┓           ┏━━━━━━━━┓         ┏━━━━━━━━┓        │
│  ┃ 🌸🌸🌸 ┃           ┃ 🌸🌸░░ ┃         ┃ 🌸░░░░ ┃        │
│  ┃ Fully  ┃           ┃ Half   ┃         ┃ Bud    ┃        │
│  ┃ Bloomed┃           ┃ Bloom  ┃         ┃        ┃        │
│  ┗━━━━━━━━┛           ┗━━━━━━━━┛         ┗━━━━━━━━┛        │
│  Neon pink glow       Soft pink glow      Subtle tint       │
└─────────────────────────────────────────────────────────────┘
```

**CSS:**
```css
.clip-card-bloom-high {
  border-color: rgba(255, 105, 180, 0.4);
  box-shadow: 0 0 30px rgba(255, 105, 180, 0.2);
}

.clip-card-bloom-high::before {
  content: '🌸🌸🌸';
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  filter: drop-shadow(0 0 4px rgba(255, 105, 180, 0.5));
}

.clip-card-bloom-mid::before {
  content: '🌸🌸░';
  /* ... */
}

.clip-card-bloom-low::before {
  content: '🌸░░░';
  /* ... */
}
```

---

### 4.7 Pipeline Steppers

**Current:** Simple dots with colors

**New:** Themed step icons with neon glow

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   📥          🎙️          ✨          🌸                   │
│   │           │           │           │                    │
│  Load       Find        Review      Render                │
│  Video   Transcribe   Highlights   Clips                  │
│   ═══        ════        ════        ════                 │
│  Done      Active     Pending     Pending                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Step States:**
```css
/* Active step — neon pulse */
.step-active .step-icon {
  color: #00ff9d;
  text-shadow: 0 0 12px rgba(0, 255, 157, 0.5);
  animation: neon-pulse 1.5s ease-in-out infinite;
}

/* Completed step — sakura fill */
.step-done .step-icon {
  color: #ffb7c5;
  background: rgba(255, 183, 197, 0.1);
  border-radius: 50%;
}

/* Pending step — muted */
.step-pending .step-icon {
  color: #6b6b8a;
  opacity: 0.5;
}
```

---

## 5. Micro-Interactions

### 5.1 Hover Effects

| Element | Effect |
|---------|--------|
| Primary Button | Gradient shimmer + neon glow |
| Card | Border brightens + subtle lift (2px) |
| Clip Card | Bloom indicator animates |
| Logo | Sakura petal rotation + glow intensify |

### 5.2 Loading Animations

**Sakura Fall (for long operations):**
```css
@keyframes sakura-drift {
  0% {
    transform: translateY(-10px) translateX(0) rotate(0deg);
    opacity: 0;
  }
  10% { opacity: 1; }
  100% {
    transform: translateY(100vh) translateX(50px) rotate(360deg);
    opacity: 0;
  }
}

.sakura-particle {
  position: fixed;
  width: 12px;
  height: 12px;
  background: linear-gradient(135deg, #ffb7c5, #ff69b4);
  border-radius: 50% 0 50% 0;
  pointer-events: none;
  z-index: 9999;
}
```

### 5.3 Success State

**After render completes:**
```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ✅ Clip rendered successfully!                            │
│                                                             │
│   ╭─────────────────────────────────────────────────────╮   │
│   │  🌸 Your clip is ready to bloom!                    │   │
│   │                                                     │   │
│   │  [ 📥 Download ]  [ 📅 Schedule ]  [ ✕ Close ]     │   │
│   ╰─────────────────────────────────────────────────────╯   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Page-by-Page Mockups

### 6.1 Home Page

```
╔═══════════════════════════════════════════════════════════════╗
║  🌸 Momiji Clipper           [Dark] [📅] [New Project] [⚙️]   ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  ╭─────────────────────────────────────────────────────────╮ ║
║  │  🎬 Start New Project                                   │ ║
║  │                                                         │ ║
║  │  Upload a video or paste a YouTube/Twitch URL to begin  │ ║
║  │                                                         │ ║
║  │  ┌────────────────────────────────────────────┬──────┐  │ ║
║  │  │ YouTube, Twitch, or Kick URL...            │ Start│  │ ║
║  │  └────────────────────────────────────────────┴──────┘  │ ║
║  │                                                         │ ║
║  │  [📁 Upload File]  [🔗 Video URL]  [📺 Twitch VOD]     │ ║
║  ╰─────────────────────────────────────────────────────────╯ ║
║                                                               ║
║  ╭─────────────────────────────────────────────────────────╮ ║
║  │  📂 Recent Videos                                       │ ║
║  │                                                         │ ║
║  │  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐      │ ║
║  │  │ 🎬   │  │ 🎬   │  │ 🎬   │  │ 🎬   │  │ 🎬   │      │ ║
║  │  │Clip 1│  │Clip 2│  │Clip 3│  │Clip 4│  │Clip 5│      │ ║
║  │  │ 5    │  │ 3    │  │ 8    │  │ 2    │  │ 12   │      │ ║
║  │  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘      │ ║
║  ╰─────────────────────────────────────────────────────────╯ ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

### 6.2 Pipeline Page (4 Steps)

```
╔═══════════════════════════════════════════════════════════════╗
║  🌸 Momiji Clipper           [Dark] [📅] [New Project] [⚙️]   ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Steps:                                                       ║
║  📥 ────── 🎙️ ────── ✨ ────── 🌸                            ║
║  Load    Transcribe  Find     Render                         ║
║  Video              Highlights Clips                         ║
║                                                               ║
║  ╭─────────────────────────────────────────────────────────╮ ║
║  │  📥 Load Video                                          │ ║
║  │                                                         │ ║
║  │  ┌─────────────────────────────────────────────────┐    │ ║
║  │  │  [Upload] [URL] [Twitch] [My VODs]              │    │ ║
║  │  │                                                 │    │ ║
║  │  │         📁                                      │    │ ║
║  │  │     Drop MP4/MKV here                           │    │ ║
║  │  │     or click to browse                          │    │ ║
║  │  └─────────────────────────────────────────────────┘    │ ║
║  ╰─────────────────────────────────────────────────────────╯ ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

### 6.3 Clip List (Video Project Page)

```
╔═══════════════════════════════════════════════════════════════╗
║  ← Back     Gaming Stream Highlights     [⚙️ Project]         ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Found 8 viral clips                           [Render All]   ║
║                                                               ║
║  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐║
║  │ 🌸🌸🌸 92       │  │ 🌸🌸░ 67       │  │ 🌸░░░ 34      │║
║  │                 │  │                 │  │                │║
║  │ She absolutely  │  │ When the chat   │  │ Calm gaming   │║
║  │ lost it         │  │ went wild       │  │ moment        │║
║  │                 │  │                 │  │                │║
║  │ 0:45 - 1:32     │  │ 12:05 - 12:48   │  │ 25:00 - 25:30 │║
║  │                 │  │                 │  │                │║
║  │ [Edit] [Preview]│  │ [Edit] [Preview]│  │ [Edit][Preview]│║
║  │ [Timeline →]    │  │ [Timeline →]    │  │ [Timeline →]  │║
║  └─────────────────┘  └─────────────────┘  └────────────────┘║
║                                                               ║
║  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐║
║  │ 🌸🌸🌸 88       │  │ 🌸🌸░ 55       │  │ 🌸░░░ 28      │║
║  │ ...             │  │ ...             │  │ ...           │║
║  └─────────────────┘  └─────────────────┘  └────────────────┘║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

### 6.4 Expanded Clip Detail

```
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║  ╭─────────────────────────────────────────────────────────╮ ║
║  │  🌸🌸🌸 92/100    "She absolutely lost it"               │ ║
║  │                                                         │ ║
║  │  ▼ Why This Clip                                        │ ║
║  │  ───────────────────────────────────────────────────    │ ║
║  │  Peak emotional outburst with perfect timing            │ ║
║  │  Brand: cozy energy, gap moe rage                       │ ║
║  │                                                         │ ║
║  │  ▶ Timing                                               │ ║
║  │  ▶ Preview (9:16)                                       │ ║
║  │                                                         │ ║
║  │  ┌─────────────────┐                                    │ ║
║  │  │   [Avatar]      │  ← 9:16 preview with              │ ║
║  │  │   ═════════     │     crop overlay                  │ ║
║  │  │   [Gameplay]    │                                    │ ║
║  │  └─────────────────┘                                    │ ║
║  │                                                         │ ║
║  │  ▼ Crop Areas              [🔄 Refresh]                 │ ║
║  │  ───────────────────────────────────────────────────    │ ║
║  │  [Interactive crop canvas for avatar + gameplay]        │ ║
║  │                                                         │ ║
║  │  ▼ Subtitle Style                                       │ ║
║  │  ───────────────────────────────────────────────────    │ ║
║  │  Font: [JetBrains Mono ▼]  Color: [███]  Size: [▮▮▮▮]  │ ║
║  │  Highlight: [███]  Outline: [▮▮▮▮]                      │ ║
║  │                                                         │ ║
║  │  ───────────────────────────────────────────────────    │ ║
║  │  [Collapse]  [Schedule]  [📅]  [Timeline Editor →]     │ ║
║  ╰─────────────────────────────────────────────────────────╯ ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## 7. Implementation Plan

### Phase 1: Foundation (Priority: High)
| Task | Files | Effort |
|------|-------|--------|
| Add Momiji color tokens | `index.css`, `tailwind.config.js` | 2 hours |
| Create `MomijiLogo` component | `components/layout/MomijiLogo.tsx` | 1 hour |
| Update navbar with new logo | `components/layout/Navbar.tsx` | 0.5 hours |
| Test light/dark mode with new colors | Manual testing | 1 hour |

### Phase 2: Core Components (Priority: High)
| Task | Files | Effort |
|------|-------|--------|
| Create button variants | `components/ui/Button.tsx` | 2 hours |
| Create card variants | `index.css` + new components | 2 hours |
| Update progress bar animation | `components/ui/ProgressBar.tsx` | 1.5 hours |
| Create themed stepper | `components/layout/BreadcrumbSteppers.tsx` | 2 hours |

### Phase 3: Personality Injection (Priority: Medium)
| Task | Files | Effort |
|------|-------|--------|
| Empty state makeovers | `HomePage.tsx`, `ProjectList.tsx` | 2 hours |
| Loading animations (sakura) | `index.css` + new component | 3 hours |
| Clip card bloom indicators | `ClipList.tsx`, `index.css` | 2 hours |
| Success/error toast themes | New `Toast` component | 2 hours |

### Phase 4: Polish (Priority: Low)
| Task | Files | Effort |
|------|-------|--------|
| Microcopy updates | All pages | 2 hours |
| Hover effect enhancements | `index.css` | 1 hour |
| Accessibility audit | Manual + automated | 2 hours |
| Performance optimization | Bundle analysis | 2 hours |

**Total Estimated Effort:** ~24 hours

---

## 8. CSS Variable Reference

### Complete Variable List (Dark Theme)
```css
[data-theme="dark"] {
  /* Brand Colors */
  --momiji-sakura: #ffb7c5;
  --momiji-neon-pink: #ff69b4;
  --momiji-red: #b40829;
  --momiji-plant: #2d5016;
  --momiji-neon-green: #00ff9d;
  
  /* Base Colors */
  --momiji-bg: #1a1a2e;
  --momiji-surface: #252542;
  --momiji-surface-light: #3a3a5c;
  --momiji-text: #f0e6ef;
  --momiji-subtext: #c9b8c8;
  --momiji-border: #4a4a6a;
  
  /* Glass surfaces */
  --glass-bg: rgba(37, 37, 66, 0.75);
  --glass-border: rgba(255, 183, 197, 0.18);
  --glass-blur: blur(16px) saturate(180%);
  --glass-shadow: 0 8px 32px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 183, 197, 0.08);
  
  /* Gradients */
  --gradient-momiji: linear-gradient(135deg, #ffb7c5 0%, #ff69b4 100%);
  --gradient-neon: linear-gradient(135deg, #ff69b4 0%, #00ff9d 100%);
  --gradient-ambient: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255, 105, 180, 0.15), transparent 70%);
  
  /* Glow effects */
  --glow-sakura: 0 0 20px rgba(255, 183, 197, 0.5);
  --glow-neon: 0 0 20px rgba(0, 255, 157, 0.5);
  --glow-primary: 0 0 20px rgba(255, 105, 180, 0.5);
}
```

---

## 9. Accessibility Guidelines

### Contrast Ratios
| Element | Minimum Ratio | Target |
|---------|---------------|--------|
| Body text | 4.5:1 | 7:1 |
| Large text | 3:1 | 4.5:1 |
| UI components | 3:1 | 4.5:1 |

### Focus States
```css
.focus-visible-momiji {
  outline: 2px solid var(--momiji-sakura);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(255, 183, 197, 0.2);
}
```

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 10. Files to Modify

### Core Styling
- `frontend/src/index.css` — Add all Momiji color tokens and variants
- `frontend/tailwind.config.js` — Add Momiji colors to Tailwind theme

### Components (New)
- `frontend/src/components/ui/MomijiLogo.tsx` — Logo component
- `frontend/src/components/ui/SakuraBackground.tsx` — Ambient particle effect
- `frontend/src/components/ui/BloomIndicator.tsx` — Virality flower indicator

### Components (Modified)
- `frontend/src/components/layout/Navbar.tsx` — New logo
- `frontend/src/components/ui/Button.tsx` — New variants
- `frontend/src/components/ui/ProgressBar.tsx` — Themed animation
- `frontend/src/components/layout/BreadcrumbSteppers.tsx` — Themed icons
- `frontend/src/pages/HomePage.tsx` — Enhanced empty states
- `frontend/src/pages/VideoProjectPage/ClipList.tsx` — Bloom indicators
- `frontend/src/pages/VideoProjectPage/ClipDetail.tsx` — Themed sections, consolidated structure

### Components (Consolidation)
- `frontend/src/pages/VideoProjectPage/ClipSectionInfo.tsx` — NEW: Timing + Why merged
- `frontend/src/pages/VideoProjectPage/ClipSectionPreviewCrop.tsx` — NEW: Preview + Crop merged
- `frontend/src/pages/VideoProjectPage/ClipSectionSubtitles.tsx` — NEW: Improve + Style merged
- `frontend/src/pages/VideoProjectPage/ClipSectionWhy.tsx` — REMOVED (merged into Info)
- `frontend/src/pages/VideoProjectPage/ClipSectionTiming.tsx` — REMOVED (merged into Info)
- `frontend/src/pages/VideoProjectPage/ClipSectionImproveSubtitles.tsx` — REMOVED (merged into Subtitles)
- `frontend/src/pages/VideoProjectPage/ClipSectionPreview.tsx` — REMOVED (merged into PreviewCrop)
- `frontend/src/pages/VideoProjectPage/ClipSectionCropAreas.tsx` — REMOVED (merged into PreviewCrop)
- `frontend/src/pages/VideoProjectPage/ClipSectionSubtitleStyle.tsx` — REMOVED (merged into Subtitles)

---

## 11. Clip Detail Consolidation (Space Optimization)

### Current Structure (7 sections, ~800px vertical)

```
┌─────────────────────────────────────────────────────────────┐
│  🌸🌸🌸 92/100    "She absolutely lost it"                  │
│  0:45 - 1:32 (47s)                                          │
├─────────────────────────────────────────────────────────────┤
│  ▼ Why This Clip                                            │
│  ─────────────────────────────────────────────────────────  │
│  [reason, brand_alignment, recommendation_reason]           │
├─────────────────────────────────────────────────────────────┤
│  ▼ Timing                                                   │
│  ─────────────────────────────────────────────────────────  │
│  [Start: 00:45]  [End: 01:32]  [twitch link]               │
├─────────────────────────────────────────────────────────────┤
│  Improve Subtitles                                          │
│  ─────────────────────────────────────────────────────────  │
│  [model select] [Transcribe button] [progress bar]         │
├─────────────────────────────────────────────────────────────┤
│  ▼ Preview (9:16)                                           │
│  ─────────────────────────────────────────────────────────  │
│  [static 9:16 frame preview]                                │
├─────────────────────────────────────────────────────────────┤
│  ▼ Crop Areas                        [🔄 Refresh]           │
│  ─────────────────────────────────────────────────────────  │
│  [interactive crop canvas - avatar + gameplay boxes]        │
├─────────────────────────────────────────────────────────────┤
│  ▼ Subtitle Style                                           │
│  ─────────────────────────────────────────────────────────  │
│  [Font] [Size] [Colors] [Outline] [Style] [Quality]        │
├─────────────────────────────────────────────────────────────┤
│  Render                                                     │
│  ─────────────────────────────────────────────────────────  │
│  [Layout options] [Render button] [Download]               │
├─────────────────────────────────────────────────────────────┤
│  [Collapse] [Schedule] [Timeline Editor →]                  │
└─────────────────────────────────────────────────────────────┘
```

**Problems:**
- Excessive scrolling to see all options
- Cognitive load from 7 separate sections
- Preview and Crop are tightly coupled but separated
- Timing and Why are both metadata, shown separately

---

### Proposed Structure (4 sections, ~450px vertical — 44% reduction)

```
┌─────────────────────────────────────────────────────────────┐
│  🌸🌸🌸 92/100    "She absolutely lost it"                  │
│  0:45 - 1:32 (47s)                                          │
├─────────────────────────────────────────────────────────────┤
│  ▼ CLIP INFO                                                │
│  ─────────────────────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Timing                                                │  │
│  │ [Start: 00:45]  [End: 01:32]  Duration: 47s          │  │
│  │                                                       │  │
│  │ Why This Clip                                         │  │
│  │ Viral Hook: Peak emotional outburst...               │  │
│  │ Brand: cozy energy, gap moe rage                     │  │
│  │ [twitch link]                                         │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  ▼ PREVIEW & CROP                  [🔄 Refresh]             │
│  ─────────────────────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │   ┌─────────────────────────┐                         │  │
│  │   │    [Avatar Crop]        │  ← 9:16 preview        │  │
│  │   │    ═════════════        │     shows crop result  │  │
│  │   │   [Gameplay Crop]       │                         │  │
│  │   └─────────────────────────┘                         │  │
│  │   [Interactive crop canvas overlay]                   │  │
│  │   Layout: ○ Stacked  ○ Camera Only  ○ Game Only       │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  ▼ SUBTITLES                                                │
│  ─────────────────────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Improve: [model ▼] [Transcribe] [✓ Ready]            │  │
│  │                                                       │  │
│  │ Style: [Font] [Size] [Colors] [Outline] [Quality]    │  │
│  └───────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  RENDER                                                     │
│  ─────────────────────────────────────────────────────────  │
│  [Render button] [Download] [Layout quick-select]          │
├─────────────────────────────────────────────────────────────┤
│  [Collapse] [Schedule] [Timeline Editor →]                  │
└─────────────────────────────────────────────────────────────┘
```

---

### Consolidation Mapping

| Before (7 sections) | After (4 sections) | Rationale |
|---------------------|-------------------|-----------|
| Why This Clip | **Clip Info** | Both are clip metadata; users reference together when evaluating clips |
| Timing | **Clip Info** | ^ |
| Improve Subtitles | **Subtitles** | Both handle subtitle pipeline — transcription feeds into styling |
| Subtitle Style | **Subtitles** | ^ |
| Preview (9:16) | **Preview & Crop** | Preview is just a static view of the crop result — redundant as separate section |
| Crop Areas | **Preview & Crop** | ^ |
| Render | **Render** | Terminal action — keep standalone for clarity |

---

### New Component: `ClipSectionInfo`

Combines timing + why + brand alignment:

```tsx
// frontend/src/pages/VideoProjectPage/ClipSectionInfo.tsx
export function ClipSectionInfo({
  clip, clipKey, clipIndex, originalSource,
  onClipUpdate, onSaveTiming,
}) {
  const [editing, setEditing] = useState<"start" | "end" | null>(null);
  const startHms = formatHms(clip.start);
  const endHms = formatHms(clip.end);

  return (
    <div className="space-y-4">
      {/* Timing — always visible */}
      <div>
        <label className="text-xs font-medium text-[var(--ctp-text)] block mb-2">
          Timing
        </label>
        <div className="grid grid-cols-2 gap-3">
          {/* Start/End inputs (inline edit with Enter/Escape) */}
        </div>
        <p className="text-xs text-[var(--ctp-subtext)] mt-2">
          Duration: {(clip.end - clip.start).toFixed(1)}s
        </p>
      </div>

      {/* Why — conditional, separated by border */}
      {(clip.reason || clip.brand_alignment?.length > 0) && (
        <div className="border-t border-[var(--ctp-overlay)] pt-4">
          <label className="text-xs font-medium text-[var(--ctp-text)] block mb-2">
            Why This Clip
          </label>
          <div className="space-y-2">
            {clip.reason && <div>...</div>}
            {clip.brand_alignment && <div>...</div>}
          </div>
        </div>
      )}

      {/* Twitch link — conditional footer */}
      {originalSource && (
        <div className="border-t border-[var(--ctp-overlay)] pt-4">
          <a href={...} className="text-xs text-[var(--ctp-blue)]">
            {twitchTimestamp(originalSource, clip.start)}
          </a>
        </div>
      )}
    </div>
  );
}
```

---

### New Component: `ClipSectionPreviewCrop`

Merges preview + crop canvas + layout selector:

```tsx
// frontend/src/pages/VideoProjectPage/ClipSectionPreviewCrop.tsx
export function ClipSectionPreviewCrop({
  layoutMode, cropBoxes, sourcePath, clipStart,
  onCropChange, onLayoutChange, onRefresh, refreshing,
}) {
  return (
    <div className="space-y-3">
      {/* 9:16 Preview with crop overlay */}
      <div className="relative mx-auto aspect-[9/16] rounded-lg overflow-hidden border-2 border-[var(--momiji-sakura)]">
        {/* Split preview: avatar top, gameplay bottom */}
        <div className="absolute inset-0 h-1/2 overflow-hidden">
          <img src={frameUrl(...)} style={{ objectPosition: avatarPos }} />
        </div>
        <div className="absolute inset-0 bottom-0 h-1/2 overflow-hidden">
          <img src={frameUrl(...)} style={{ objectPosition: gameplayPos }} />
        </div>
      </div>

      {/* Crop canvas (interactive) */}
      <CropCanvas
        frameUrl={frameUrl(...)}
        onChange={onCropChange}
        initialGameplay={cropBoxes.gameplay}
        initialAvatar={cropBoxes.avatar}
        layoutMode={layoutMode}
      />

      {/* Layout quick-select */}
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="layout" value="stacked" ... />
          <span className="text-xs">Stacked</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="layout" value="camera_only" ... />
          <span className="text-xs">Camera Only</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="layout" value="gameplay_only" ... />
          <span className="text-xs">Game Only</span>
        </label>
        <button onClick={onRefresh} disabled={refreshing} className="ml-auto">
          {refreshing ? <Spinner /> : <RefreshIcon />} Refresh
        </button>
      </div>
    </div>
  );
}
```

---

### New Component: `ClipSectionSubtitles`

Combines improve transcription + style settings:

```tsx
// frontend/src/pages/VideoProjectPage/ClipSectionSubtitles.tsx
export function ClipSectionSubtitles({
  hasImprovedTranscript, progress, model, onImprove,
  fontName, fontColor, highlightColor, outlineColor,
  fontSize, captionStyle, qualityPreset, nvencAvailable,
  onUpdate,
}) {
  return (
    <div className="space-y-4">
      {/* Improve — compact inline */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase">
            Improve Subtitles
          </p>
          <p className="text-xs text-[var(--ctp-subtext)]">
            Re-transcribe with larger model for better accuracy
          </p>
        </div>
        {hasImprovedTranscript && (
          <span className="text-xs text-green-400">✓ Ready</span>
        )}
        <select value={model} onChange={...} className="input-field">
          <option value="medium">medium</option>
          <option value="large-v3">large-v3</option>
        </select>
        <button onClick={onImprove} disabled={progress || hasImprovedTranscript}>
          {progress ? "Transcribing…" : "Transcribe"}
        </button>
      </div>
      {progress && <ProgressBar progress={progress.value} label={progress.label} />}

      {/* Style — 2-column grid */}
      <div className="border-t border-[var(--ctp-overlay)] pt-4">
        <label className="text-xs font-medium text-[var(--ctp-text)] block mb-3">
          Style
        </label>
        <div className="grid grid-cols-2 gap-3">
          {/* Font, Size, Colors, Outline */}
        </div>
        <div className="flex gap-4 mt-3">
          {/* Caption style: Karaoke / CapCut */}
        </div>
        <div className="flex gap-4 mt-3">
          {/* Quality: Standard / Production / NVENC */}
        </div>
      </div>
    </div>
  );
}
```

---

### Updated `ClipDetail` Structure

```tsx
// frontend/src/pages/VideoProjectPage/ClipDetail.tsx
export function ClipDetail({ ... }) {
  return (
    <div className="col-span-full glass-card p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold">{clip.title}</h3>
          <p className="text-xs text-[var(--ctp-subtext)]">
            {formatTime(clip.start)} - {formatTime(clip.end)}
          </p>
        </div>
        <BloomIndicator score={clip.virality_score} />
      </div>

      {/* 4 consolidated sections */}
      <CollapsibleSection title="Clip Info" ...>
        <ClipSectionInfo {...} />
      </CollapsibleSection>

      <CollapsibleSection title="Preview & Crop" ...>
        <ClipSectionPreviewCrop {...} />
      </CollapsibleSection>

      <CollapsibleSection title="Subtitles" ...>
        <ClipSectionSubtitles {...} />
      </CollapsibleSection>

      <ClipSectionRender {...} />

      {/* Actions */}
      <div className="flex gap-2 mt-4 pt-4 border-t">
        <Button onClick={onCollapse}>Collapse</Button>
        <Button onClick={onSchedule}>Schedule</Button>
        <Link to={...}>Timeline Editor →</Link>
      </div>
    </div>
  );
}
```

---

### Benefits

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Sections | 7 | 4 | 43% fewer |
| Vertical space | ~800px | ~450px | 44% reduction |
| Clicks to complete workflow | 12+ | 8 | 33% fewer |
| Cognitive load | High (scattered) | Medium (grouped) | Better mental model |

---

## 12. Success Metrics

After implementation, measure:
- [ ] User engagement time (target: +15%)
- [ ] Clip render completion rate (target: +10%)
- [ ] User satisfaction survey (target: 4.5/5)
- [ ] Accessibility audit score (target: 95+)
- [ ] Performance (Lighthouse score target: 90+)
- [ ] Time-to-render for new users (target: -25%)

---

## Appendix A: Inspiration References

- [Momiji Yoru HoloList Profile](https://hololist.net/momiji-yoru/)
- [Momiji Brand Colors (ColorsWall)](https://colorswall.com/palette/169468)
- [Cyberpunk Design Trends 2026](https://www.behance.net/search/projects/cyberpunk%20ui)
- [Sakura Animation Examples](https://codepen.io/search/pens?q=sakura+animation)

---

*Document created: 2026-05-04*  
*Last updated: 2026-05-04*
