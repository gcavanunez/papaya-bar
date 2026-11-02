# Tech Debt TODO List

## Critical Priority (Security & Stability)

### 1. Remove Excessive Chrome Permissions
- **Issue**: Manifest requests overly broad permissions including `<all_urls>`, `nativeMessaging`, `system.display`
- **Impact**: Security risk, user trust, Chrome Web Store approval issues
- **Files**: `manifest.json:8-26`
- **Action**: Audit and remove unused permissions, use minimal required permissions

### 2. Clean Up Dead Code Files
- **Issue**: `public/content-old.js` contains duplicate/unused code
- **Impact**: Bundle size, maintenance confusion
- **Files**: `public/content-old.js`
- **Action**: Remove file if truly unused, or consolidate with `content.ts`

### 3. Fix TypeScript Configuration Issues
- **Issue**: Commented out strict TypeScript rules in `tsconfig.json:21-23`
- **Impact**: Type safety, potential runtime errors
- **Files**: `tsconfig.json:21-23`
- **Action**: Enable `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`

## High Priority (Code Quality & Maintainability)

### 4. Remove Console Logging from Production Code
- **Issue**: 74+ console.log statements throughout codebase
- **Impact**: Performance, security (potential data leaks), unprofessional
- **Files**: Multiple files (background.js, hooks/, components/, views/)
- **Action**: Remove debug logs, implement proper logging strategy

### 5. Eliminate TypeScript `any` Usage
- **Issue**: 17 instances of `any` type usage
- **Impact**: Type safety, IDE support, potential runtime errors
- **Files**: `src/hooks/usePopper.ts:16-18`, `src/hooks/useSessionsData.ts:321,359`, others
- **Action**: Replace with proper types, create interfaces where needed

### 6. Resolve Component Naming Inconsistencies
- **Issue**: Both `AppBtn.vue` and `AppButton.vue` exist
- **Impact**: Developer confusion, potential duplicate functionality
- **Files**: `src/components/AppBtn.vue`, `src/components/AppButton.vue`
- **Action**: Consolidate into single component with consistent naming

### 7. Clean Up Commented ESLint Configuration
- **Issue**: Large block of commented old ESLint config in `eslint.config.js:1-24`
- **Impact**: File bloat, maintenance confusion
- **Files**: `eslint.config.js:1-24`
- **Action**: Remove commented code, keep only active configuration

## Medium Priority (Performance & Architecture)

### 8. Optimize Background Script Performance
- **Issue**: Complex nested functions, potential memory leaks in event listeners
- **Impact**: Extension performance, battery usage
- **Files**: `background.js:45-158`, `background.js:173-218`
- **Action**: Refactor into smaller functions, review event listener cleanup

### 9. Implement Proper Error Handling
- **Issue**: Missing error handling in async operations, basic try-catch usage
- **Impact**: User experience, debugging difficulty
- **Files**: `src/hooks/useSessionsData.ts`, `background.js`
- **Action**: Add comprehensive error handling, user-friendly error messages

### 10. Consolidate Duplicate Screenshot Logic
- **Issue**: Duplicate screenshot functionality in multiple files
- **Impact**: Code duplication, maintenance burden
- **Files**: `background.js:79-132`, `background.js:189-217`, `content.ts:58-72`
- **Action**: Extract to shared utility function

### 11. Improve Component Architecture
- **Issue**: Large components with mixed concerns (TabManager.vue, Index.vue have similar code)
- **Impact**: Maintainability, reusability
- **Files**: `src/components/TabManager.vue`, `src/views/Index.vue`
- **Action**: Extract shared logic into composables, split large components

## Low Priority (Developer Experience)

### 12. Add Missing Type Definitions
- **Issue**: Custom types in `src/custom.d.ts` are incomplete
- **Impact**: IDE support, type safety
- **Files**: `src/custom.d.ts:12,18-19`
- **Action**: Complete type definitions, remove commented placeholders

### 13. Standardize Import Patterns
- **Issue**: Inconsistent import styles (some relative, some absolute)
- **Impact**: Code consistency, refactoring difficulty
- **Files**: Multiple files
- **Action**: Establish and enforce consistent import patterns

### 14. Update Package Dependencies
- **Issue**: Some dependencies may have newer versions available
- **Impact**: Security, performance, new features
- **Files**: `package.json`
- **Action**: Audit and update dependencies, test for breaking changes

### 15. Improve Build Configuration
- **Issue**: Build script includes type checking that could be separate
- **Impact**: Build performance, CI/CD efficiency
- **Files**: `package.json:9`
- **Action**: Separate type checking from build process

## Notes
- Existing `TODOS.md` contains feature-level todos; this list focuses on technical debt
- Priority based on security impact, code maintainability, and development velocity
- Estimated effort ranges from 1-4 hours per item for most issues