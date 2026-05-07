# Momiji Clipper — UI/UX Implementation Checklist

**Theme:** Neon Sakura  
**Status:** Ready to Implement  
**Created:** 2026-05-04

---

## Quick Reference

| Priority | Phase | Tasks | Est. Hours |
|----------|-------|-------|------------|
| 🔴 High | Phase 0 | Consolidation (7→4 sections, space optimization) | 6 |
| 🔴 High | Phase 1 | Foundation (colors, logo, navbar) | 4.5 |
| 🔴 High | Phase 2 | Core Components (buttons, cards, progress) | 7.5 |
| 🟡 Medium | Phase 3 | Personality (empty states, animations) | 8 |
| 🟢 Low | Phase 4 | Polish (microcopy, hover effects) | 5 |

---

## Phase 0: Clip Detail Consolidation 🔴 HIGH PRIORITY (Space Optimization)

**Goal:** Reduce clip detail vertical space by 44% (7 sections → 4 sections)

### 0.1 Create Consolidated Components
**Files:** (NEW)
- `frontend/src/pages/VideoProjectPage/ClipSectionInfo.tsx`
- `frontend/src/pages/VideoProjectPage/ClipSectionPreviewCrop.tsx`
- `frontend/src/pages/VideoProjectPage/ClipSectionSubtitles.tsx`

- [ ] Create `ClipSectionInfo` — merges Timing + Why This Clip
- [ ] Create `ClipSectionPreviewCrop` — merges Preview + Crop Areas + layout selector
- [ ] Create `ClipSectionSubtitles` — merges Improve + Subtitle Style
- [ ] Update `ClipDetail.tsx` to use 4 consolidated sections
- [ ] Test all clip interactions work correctly
- [ ] Remove old components (Why, Timing, Improve, Preview, CropAreas, SubtitleStyle)

### 0.2 Update ClipDetail Structure
**File:** `frontend/src/pages/VideoProjectPage/ClipDetail.tsx`

- [ ] Replace 7 CollapsibleSections with 4
- [ ] Verify all props are passed to new components
- [ ] Test expand/collapse behavior
- [ ] Test keyboard navigation (Enter/Escape in timing inputs)

---

## Phase 1: Foundation 🔴 HIGH PRIORITY

### 1.1 Add Momiji Color Tokens
**File:** `frontend/src/index.css`

- [ ] Add brand color variables (sakura, neon-pink, red, plant, neon-green)
- [ ] Add base palette variables (bg, surface, surface-light, text, subtext, border)
- [ ] Add semantic color variables (success, error, warning, info, primary)
- [ ] Add gradient definitions
- [ ] Add glow effect variables
- [ ] Update light theme variables to match
- [ ] Test both themes with new colors

**Code Snippet:**
```css
/* Add to :root and [data-theme="dark"] sections */
--momiji-sakura: #ffb7c5;
--momiji-neon-pink: #ff69b4;
--momiji-red: #b40829;
--momiji-plant: #2d5016;
--momiji-neon-green: #00ff9d;
--momiji-bg: #1a1a2e;
--momiji-surface: #252542;
--momiji-surface-light: #3a3a5c;
--momiji-text: #f0e6ef;
--momiji-subtext: #c9b8c8;
--momiji-border: #4a4a6a;
```

### 1.2 Update Tailwind Config
**File:** `frontend/tailwind.config.js`

- [ ] Add `momiji` colors to `theme.extend.colors`
- [ ] Add custom gradients to `theme.extend.backgroundImage`
- [ ] Add neon glow utilities to `theme.extend.boxShadow`

**Code Snippet:**
```js
colors: {
  momiji: {
    sakura: '#ffb7c5',
    'neon-pink': '#ff69b4',
    red: '#b40829',
    plant: '#2d5016',
    'neon-green': '#00ff9d',
    bg: '#1a1a2e',
    surface: '#252542',
    text: '#f0e6ef',
    subtext: '#c9b8c8',
  }
}
```

### 1.3 Create MomijiLogo Component
**File:** `frontend/src/components/ui/MomijiLogo.tsx` (NEW)

- [ ] Create SVG sakura leaf icon
- [ ] Add gradient text treatment
- [ ] Add hover animation (glow intensify)
- [ ] Export component

### 1.4 Update Navbar
**File:** `frontend/src/components/layout/Navbar.tsx`

- [ ] Replace text-only logo with `MomijiLogo` component
- [ ] Update theme toggle styling to match new theme
- [ ] Test responsive behavior

---

## Phase 2: Core Components 🔴 HIGH PRIORITY

### 2.1 Button Variants
**File:** `frontend/src/components/ui/Button.tsx`

- [ ] Add `momiji-primary` variant (gradient)
- [ ] Add `momiji-neon` variant (cyber accent)
- [ ] Update `variantClasses` mapping
- [ ] Add hover shimmer effect
- [ ] Test all variants in light/dark mode

### 2.2 Card Variants
**File:** `frontend/src/index.css`

- [ ] Add `.glass-card-elevated` class
- [ ] Add `.glass-card-subtle` class
- [ ] Document usage in design spec comments

### 2.3 Progress Bar Animation
**File:** `frontend/src/components/ui/ProgressBar.tsx`

- [ ] Update gradient to Momiji colors
- [ ] Add sakura petal particle animation
- [ ] Add label styling with new fonts

### 2.4 Stepper/Breadcrumb Update
**File:** `frontend/src/components/layout/BreadcrumbSteppers.tsx`

- [ ] Replace dots with themed icons (📥 🎙️ ✨ 🌸)
- [ ] Add neon glow for active step
- [ ] Add sakura fill for completed steps

---

## Phase 3: Personality Injection 🟡 MEDIUM PRIORITY

### 3.1 Empty State Makeover
**Files:** 
- `frontend/src/pages/HomePage.tsx`
- `frontend/src/components/projects/ProjectList.tsx`

- [ ] Add sakura icon + "clip garden" metaphor
- [ ] Update microcopy to match brand voice
- [ ] Add CTA button with gradient

### 3.2 Sakura Loading Animation
**File:** `frontend/src/components/ui/SakuraBackground.tsx` (NEW)

- [ ] Create falling petal particle system
- [ ] Add CSS keyframes for drift animation
- [ ] Create React component for overlay
- [ ] Add prop for intensity/density

### 3.3 Clip Card Bloom Indicators
**Files:**
- `frontend/src/pages/VideoProjectPage/ClipList.tsx`
- `frontend/src/index.css`

- [ ] Replace simple border with bloom indicator
- [ ] Add 🌸🌸🌸 / 🌸🌸░ / 🌸░░░ based on score
- [ ] Add neon glow for high-virality clips
- [ ] Update `getViralityBadgeColor()` function

### 3.4 Success/Error Toast Themes
**File:** `frontend/src/components/ui/Toast.tsx` (NEW)

- [ ] Create toast notification component
- [ ] Add themed success state (sakura + plant)
- [ ] Add themed error state (red + neon)
- [ ] Add slide-in animation

---

## Phase 4: Polish 🟢 LOW PRIORITY

### 4.1 Microcopy Updates
**Files:** All page components

- [ ] Update button labels to be more playful
- [ ] Add tooltip hints with personality
- [ ] Update error messages to be friendly
- [ ] Add emoji accents where appropriate

**Examples:**
| Current | New |
|---------|-----|
| "Loading..." | "Growing your clips... 🌱" |
| "No videos yet" | "Your clip garden is empty 🌸" |
| "Render complete" | "Your clip is ready to bloom! 🌸" |
| "Error" | "Oops! Something went wrong" |

### 4.2 Hover Effect Enhancements
**File:** `frontend/src/index.css`

- [ ] Add card lift on hover (2px translateY)
- [ ] Add border brighten transition
- [ ] Add neon glow intensify for buttons

### 4.3 Accessibility Audit
**Tasks:**
- [ ] Run automated accessibility testing (axe-core)
- [ ] Check color contrast ratios
- [ ] Test keyboard navigation
- [ ] Test screen reader compatibility
- [ ] Fix any issues found

### 4.4 Performance Optimization
**Tasks:**
- [ ] Run Lighthouse audit
- [ ] Optimize animation performance
- [ ] Check bundle size impact
- [ ] Lazy load heavy components (SakuraBackground)

---

## Component Code Templates

### MomijiLogo Component
```tsx
// frontend/src/components/ui/MomijiLogo.tsx
import { Link } from 'react-router-dom';

export function MomijiLogo() {
  return (
    <Link 
      to="/" 
      className="flex items-center gap-2 group hover:opacity-90 transition-opacity"
    >
      {/* Sakura Leaf Icon */}
      <div className="relative w-6 h-6">
        <svg 
          className="w-6 h-6 text-momiji-sakura animate-pulse-slow" 
          viewBox="0 0 24 24" 
          fill="currentColor"
        >
          <path d="M12 2C9.5 2 7 4.5 7 7c0 1.5.5 2.5 1.5 3.5C7 11.5 4 14 4 17c0 2.5 2 4 4.5 4S13 19.5 13 17c0-1-.5-2-1-2.5 1 .5 2.5.5 3.5 0C15 15 14.5 16 14.5 17c0 2.5 2 4 4.5 4s4.5-1.5 4.5-4c0-3-3-5.5-4.5-6.5C20 9.5 20.5 8.5 20.5 7c0-2.5-2.5-5-5-5S13 4.5 13 7c0 1 .5 2 1 2.5-1-.5-2.5-.5-3.5 0C11 9 11.5 8 11.5 7c0-2.5-2-5-4.5-5z"/>
        </svg>
        {/* Glow effect */}
        <div className="absolute inset-0 bg-momiji-sakura blur-md opacity-30 group-hover:opacity-60 transition-opacity" />
      </div>
      
      {/* Gradient Wordmark */}
      <span className="text-lg font-bold bg-gradient-to-r from-momiji-sakura to-momiji-neon-pink bg-clip-text text-transparent">
        Momiji Clipper
      </span>
    </Link>
  );
}
```

### Bloom Indicator Component
```tsx
// frontend/src/components/ui/BloomIndicator.tsx
interface BloomIndicatorProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

export function BloomIndicator({ score, size = 'sm' }: BloomIndicatorProps) {
  const getBloom = (score: number) => {
    if (score >= 80) return '🌸🌸🌸';
    if (score >= 50) return '🌸🌸░';
    return '🌸░░░';
  };

  const getGlowClass = (score: number) => {
    if (score >= 80) return 'bloom-glow-high';
    if (score >= 50) return 'bloom-glow-mid';
    return '';
  };

  return (
    <span className={`bloom-indicator ${getGlowClass(score)}`}>
      {getBloom(score)}
    </span>
  );
}
```

### Sakura Background Component
```tsx
// frontend/src/components/ui/SakuraBackground.tsx
import { useEffect, useState } from 'react';

interface SakuraBackgroundProps {
  intensity?: 'low' | 'medium' | 'high';
  children?: React.ReactNode;
}

export function SakuraBackground({ intensity = 'medium', children }: SakuraBackgroundProps) {
  const [petals, setPetals] = useState<Array<{ id: number; left: number; delay: number }>>([]);

  useEffect(() => {
    const petalCount = intensity === 'high' ? 30 : intensity === 'medium' ? 15 : 5;
    const newPetals = Array.from({ length: petalCount }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 5,
    }));
    setPetals(newPetals);
  }, [intensity]);

  return (
    <div className="relative">
      {/* Falling petals overlay */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
        {petals.map((petal) => (
          <div
            key={petal.id}
            className="absolute sakura-particle"
            style={{
              left: `${petal.left}%`,
              animationDelay: `${petal.delay}s`,
            }}
          />
        ))}
      </div>
      {children}
    </div>
  );
}
```

---

## CSS Animation Keyframes

Add these to `frontend/src/index.css`:

```css
/* Sakura petal fall */
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
  width: 12px;
  height: 12px;
  background: linear-gradient(135deg, #ffb7c5, #ff69b4);
  border-radius: 50% 0 50% 0;
  animation: sakura-drift 3s ease-out infinite;
}

/* Neon pulse */
@keyframes neon-pulse {
  0%, 100% {
    box-shadow: 0 0 10px rgba(0, 255, 157, 0.2);
  }
  50% {
    box-shadow: 0 0 20px rgba(0, 255, 157, 0.5);
  }
}

/* Slow pulse for logo */
@keyframes pulse-slow {
  0%, 100% { opacity: 0.8; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
}

.animate-pulse-slow {
  animation: pulse-slow 3s ease-in-out infinite;
}
```

---

## Testing Checklist

### Visual Regression
- [ ] Homepage (empty state, recent videos)
- [ ] Pipeline page (all 4 steps)
- [ ] Clip list page (collapsed + expanded)
- [ ] Timeline editor
- [ ] Login/Register pages
- [ ] Settings modal

### Interactive Testing
- [ ] All button hover states
- [ ] Card hover effects
- [ ] Progress bar animations
- [ ] Modal open/close
- [ ] Dropdown menus
- [ ] Form inputs (focus states)

### Accessibility
- [ ] Tab through all interactive elements
- [ ] Test with screen reader
- [ ] Check color contrast
- [ ] Verify focus indicators
- [ ] Test reduced motion mode

### Responsive
- [ ] Mobile (< 640px)
- [ ] Tablet (640-1024px)
- [ ] Desktop (> 1024px)
- [ ] Ultra-wide (> 1920px)

---

## Rollback Plan

If issues arise after deployment:

1. **Color issues:** Revert `index.css` changes, keep components
2. **Component issues:** Comment out new components, keep colors
3. **Performance issues:** Disable SakuraBackground, reduce animations

**Git branch strategy:**
- Create feature branch: `feature/neon-sakura-theme`
- Test in staging environment first
- Deploy to 10% of users initially
- Monitor for 48 hours before full rollout

---

## Sign-Off

| Role | Name | Date | Status |
|------|------|------|--------|
| Design | | | ⬜ |
| Frontend Lead | | | ⬜ |
| QA | | | ⬜ |
| Product | | | ⬜ |

---

*Last updated: 2026-05-04*
