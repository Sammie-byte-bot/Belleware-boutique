# Mobile Header Fix Plan for Account Page

## Status: Pending User Confirmation

### Step 1: Enhance main.js Header Height Calculation

- [ ] Add ResizeObserver for real-time mobile layout detection
- [ ] Trigger recalc after media query changes
- [ ] Dispatch 'header:height-updated' event

### Step 2: Update account.html Inline Styles

- [ ] Define mobile `--header-height` vars in media queries (120px, 100px etc.)
- [ ] Use `padding-top` instead of `margin-top` for .account-page
- [ ] Reduce conflicting `!important` overrides

### Step 3: Global style.css Consistency

- [ ] Add :root mobile height vars
- [ ] Ensure header consistency across pages

### Step 4: Test & Verify

- [ ] Test on iPhone SE/12 DevTools
- [ ] Check no overlap, smooth scroll
- [ ] `npx serve .` live test

### Step 5: Completion

- [ ] attempt_completion
