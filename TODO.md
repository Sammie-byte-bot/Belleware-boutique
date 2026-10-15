# Mobile Header Fix Plan for Account Page - Approved & In Progress

## Completed Steps

✅ **Step 0**: Analyzed files (main.js, style.css, account.html, TODO.md)  
✅ **Step 1**: Created detailed edit plan with file-level changes

## Granular Task List (Breakdown of Approved Plan)

### Phase 1: Prepare & Remove Duplication (account.html)

✅ **Phase 1 COMPLETE** - account.html clean (no header/CSS conflicts, padding preserved)

### Phase 2: Enhance Dynamic Header (main.js)

✅ **2.1** read_file main.js (verified enhanced setHeaderVar + ResizeObserver + matchMedia + 120px mobile fallback)

- [ ] **2.2** Add 'header:height-updated' event listener (if needed)
- [ ] **2.3** Test dispatch across pages
- [ ] **2.4** Verify ~120px mobile calc
- [ ] **2.5** Final main.js validation

### Phase 3: Global Fallbacks (style.css)

✅ **3.1** Added :root @media fallbacks (768px:120px, 600px:110px, 480px:100px)

- [ ] **3.2** Verify style.css integration
- [ ] **3.3** Cross-browser check

### Phase 4: Verify & Test

- [ ] **4.1** execute_command `npx serve .`
- [ ] **4.2** DevTools mobile testing
- [ ] **4.3** Header parity check
- [ ] **4.4** Resize/orientation tests

### Phase 5: Completion

- [ ] **5.1** Final TODO.md update
- [ ] **5.2** attempt_completion

### Phase 2: Enhance Dynamic Header (main.js)

- [ ] **2.1** read_file main.js (current setHeaderVar function)
- [ ] **2.2** Add ResizeObserver + matchMedia('<=768px') for mobile detection
- [ ] **2.3** Dispatch 'header:height-updated' custom event
- [ ] **2.4** Ensure ~120px mobile height calculation (header-top + nav-bar)
- [ ] **2.5** edit_file main.js with improvements

### Phase 3: Global Fallbacks (style.css)

- [ ] **3.1** read_file style.css (verify existing mobile @media rules)
- [ ] **3.2** Add :root @media fallbacks: max-768px:120px, max-600px:110px etc.
- [ ] **3.3** edit_file style.css if needed

### Phase 4: Verify & Test

- [ ] **4.1** execute_command `npx serve .` for live testing
- [ ] **4.2** DevTools: iPhone SE (375px), iPhone 12 (390px) - check no overlap
- [ ] **4.3** Verify header matches shop.html exactly
- [ ] **4.4** Test resize/orientation changes

### Phase 5: Completion

- [ ] **5.1** Update this TODO.md (mark all ✅)
- [ ] **5.2** attempt_completion "Mobile header fixed across pages"

**Current Progress: 2/25 tasks complete**  
**Next: Phase 1.1 - read_file account.html**  
**ETA: 10 mins**
