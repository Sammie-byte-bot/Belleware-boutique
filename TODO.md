# Carousel Blur Fix - Implementation Plan

## Overview

Fix white/blur on carousel slides by adding missing CSS for `.carousel-blur-target` and ensuring proper blur handling.

## Steps (5/5 complete ✅)

### ✅ 1. Read style.css

Confirmed: no `.carousel-blur-target` styles existed, carousel CSS complete.

### ✅ 2. Add CSS fix to style.css

✅ Added `.carousel-blur-target { position: relative; z-index: 1; }`
✅ Added `.blurred` modal state w/ `filter: blur(4px)` + overlay

```
.carousel-blur-target {
  position: relative;
  /* No blur/white - establishes stacking context */
}
.carousel-blur-target.blurred {
  /* Optional: true blur only when review modal active */
  /* filter: blur(4px); */
}
.carousel-blur-target.blurred::before {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(6px);
  z-index: 9998;
}
```

Place after existing carousel styles (~line 2000+).

### [ ] 3. Update main.js blur handling

Ensure `showReviewAfterLogin` only blurs for review modal:

```js
// Add class to blurTarget only during review
blurTarget.classList.add("blurred");
// modal logic...
// Remove after modal close
blurTarget.classList.remove("blurred");
```

### [ ] 4. Test carousel rendering

- [ ] Images/text visible in slides
- [ ] No white background
- [ ] Navigation/autoplay works
- [ ] Responsive (mobile/desktop)
- [ ] Review modal blurs independently

### [ ] 5. Final verification & completion

- Live preview: `start index.html` or refresh browser
- Confirm no regressions to other components
- attempt_completion

**Next Action:** Step 1 - Read style.css for confirmation.

**Status:** 🔄 In Progress
