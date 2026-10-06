# Vernal - Agent Project Brief

This document describes the project's features, architecture, functions, and implementation details so another agent can understand the codebase quickly and make changes within the appropriate modules. Some Vietnamese strings in the source and README appeared garbled when read through the terminal; the notes below flag those observations without assuming whether the underlying files or terminal decoding are responsible.

## 1. Quick Overview

Vernal is a Chrome extension built with WXT, React, and JavaScript ESM. Its main features are:

- Support for learning on LMS websites, with a dedicated PTTC1 Moodle provider (`lms.pttc1.edu.vn`) and a generic LMS provider.
- Automatic learning-page detection, video playback when enabled, and navigation to the next lesson after two seconds when enabled.
- Resuming the course with the lowest progress after login.
- A floating course-progress panel on the Moodle dashboard.
- LLM-generated forum question and answer drafts, without automatically submitting posts.
- Extension settings stored in `browser.storage.local`.

Main stack:

- `wxt`: extension build framework.
- `@wxt-dev/module-react`: React integration for popup and options entrypoints.
- `react`, `react-dom`, `@chakra-ui/react`: popup and options UI.
- `tailwindcss`: CSS utilities integrated through a Vite plugin.
- `eslint`, `prettier`: linting and formatting.

Common commands:

```bash
npm install
npm run dev
npm run build
npm run zip
npm run lint
npm run format:check
```

## 2. Directory Structure

```text
entrypoints/
  background.js              # WXT background entry; registers the runtime message listener.
  content.js                 # Resolves the provider and creates the learning controller.
  popup/
    index.html
    main.jsx                 # Popup React UI.
  options/
    index.html
    main.jsx                 # Options React UI.

src/
  background/
    message-router.js         # Routes background messages for LLM drafts and account binding.
  content/
    auto-resume.js            # Resumes the course with the lowest progress.
    course-status-panel.js    # Floating course-progress panel.
    forum-helper.js           # Forum UI and application of LLM drafts.
    learning-controller.js    # Coordinates automation on LMS pages.
  providers/
    generic-lms.provider.js   # Generic LMS adapter.
    pttc1.provider.js         # PTTC1 Moodle adapter.
    provider-registry.js      # Selects a provider based on the page location.
  services/
    account-binding.js        # Binds an LMS account, optionally using a verification API.
    llm-client.js             # Calls Vilao/OpenAI-compatible chat completions.
  shared/
    browser.js                # Active-tab and tab-message helpers.
    constants.js              # Message types and default settings.
    settings-store.js         # Wrapper around browser.storage.local.
  ui/
    globals.css
    settings-theme.css
```

## 3. Manifest and Permissions

File: `wxt.config.js`.

- Uses `defineConfig` from `wxt`.
- Enables React through `modules: ['@wxt-dev/module-react']`.
- Adds the Tailwind plugin through Vite.
- Manifest configuration:
  - `name`: Vernal.
  - `description`: describes the extension as an online-learning assistant.
  - `permissions`: `storage`, `activeTab`.
  - `host_permissions`: `https://*/*`.
  - `options_ui`: `options.html`, opened in a tab.
- `imports: false`: the project uses explicit imports rather than WXT auto-imports.

The content script matches every HTTPS page, but initializes its controller only when `resolveProvider(window.location)` returns a provider.

## 4. Shared Constants and Settings

File: `src/shared/constants.js`.

### `MESSAGE`

A frozen object containing internal message types:

| Message | Purpose |
| --- | --- |
| `COURSE_STATUS` | Asks the content script whether the current page is supported. |
| `NEXT_LESSON` | Requests navigation to the next lesson. |
| `GENERATE_DISCUSSION` | Requests an LLM discussion draft from the background layer. |
| `ACCOUNT_STATUS` | Asks the provider for the LMS login status. |
| `BIND_ACCOUNT` | Binds the LMS account, optionally through a verification API. |
| `LOGIN_WITH_SAVED_CREDENTIALS` | Fills and submits the login form using saved credentials. |
| `REFRESH_COURSE_PANEL` | Refreshes or hides the course-progress panel according to settings. |
| `START_AUTO_RESUME` | Starts the course-resume flow. |

### `DEFAULT_SETTINGS`

Default configuration used by the storage wrapper:

| Setting | Meaning and Implementation Notes |
| --- | --- |
| `assistEnabled` | Present in settings; no use was identified in the main code paths. |
| `extensionEnabled` | Master switch; defaults to `true`. |
| `allowedDomains` | Hostnames permitted for the controller's domain-gated automation. An empty list allows all matched providers. |
| `llmEndpoint` | Defaults to `https://api.vilao.ai/v1/chat/completions`, but the LLM client currently uses a hard-coded constant instead. |
| `llmApiKey` | Bearer token for LLM requests and optional account verification. |
| `llmModel` | Defaults to `gpt-4o`. |
| `accountVerifyEndpoint` | Optional endpoint for verifying the LMS account. |
| `boundAccount` | The bound LMS account identity. |
| `pttc1Username` | Saved PTTC1 username. |
| `pttc1Password` | Saved PTTC1 password. |
| `pttc1AutoLogin` | Enables automatic PTTC1 login. |
| `showCourseStatus` | Shows the course-progress panel on dashboard pages. |
| `autoResumeCourse` | Enables resuming a course after login. |
| `autoNextLesson` | Enables automatic next-lesson navigation. |
| `autoPlayVideo` | Enables automatic video playback. |
| `autoStartQuiz` | Present in settings; no use was identified in the main code paths. |

File: `src/shared/settings-store.js`.

### `settingsStore.get()`

Calls `browser.storage.local.get(DEFAULT_SETTINGS)`, merges the result with defaults, and returns the settings object.

### `settingsStore.patch(changes)`

Calls `browser.storage.local.set(changes)`. It does not perform a deep merge; callers must supply the fields they intend to update.

File: `src/shared/browser.js`.

### `getActiveTab()`

Queries the active tab in the last focused window through `browser.tabs.query`. Throws if no `tab.id` is available.

### `sendToActiveTab(tabId, message)`

Sends a message using `browser.tabs.sendMessage`. Returns `null` on failure instead of throwing, allowing the popup to handle pages without a content-script listener.

## 5. Background Layer

File: `entrypoints/background.js`.

- Uses WXT's `defineBackground`.
- Registers `browser.runtime.onMessage.addListener(handleMessage)`.

File: `src/background/message-router.js`.

### `handleMessage(message)`

Routes background messages:

- `MESSAGE.GENERATE_DISCUSSION`: calls `generateDiscussionDraft(message.payload)`.
- `MESSAGE.BIND_ACCOUNT`: calls `bindLmsAccount(message.payload)`.
- Other messages: returns `undefined`.

The background layer handles network and storage service work. Page DOM manipulation belongs to the content layer.

## 6. LLM Service

File: `src/services/llm-client.js`.

### `VILAO_CHAT_COMPLETIONS_URL`

Hard-coded URL: `https://api.vilao.ai/v1/chat/completions`.

`DEFAULT_SETTINGS.llmEndpoint` exists but is not currently consumed here. Supporting a configurable endpoint requires updating `generateDiscussionDraft` to read it.

### `generateDiscussionDraft({ courseName, chapterName, topic, context })`

1. Reads settings from storage.
2. Requires `llmApiKey`; throws if missing.
3. Requires `boundAccount`; throws if missing. This is the account-binding gate for LLM access.
4. Calls the chat-completions endpoint with:
   - `Content-Type: application/json`.
   - `Authorization: Bearer <llmApiKey>` when a key is present.
   - `model: settings.llmModel`.
   - `max_tokens: 500`.
   - A system prompt requiring valid JSON with `title`, `question`, and `answer` fields.
   - A user prompt containing the course, chapter or lesson, and LMS context.
5. Throws an error containing the HTTP status if the response is not successful.
6. Returns `response.json()`.

The forum helper parses the returned draft before applying it to a form. Invalid JSON prevents that application.

## 7. Account Binding Service

File: `src/services/account-binding.js`.

### `bindLmsAccount(account)`

Binds the extension to an authenticated LMS account:

1. Validates that `account.authenticated` is true and both `account.accountId` and `account.hostname` are present.
2. Creates the payload `{ accountId, hostname }`.
3. Rejects a different account if `settings.boundAccount` already exists. The existing binding must be cleared before binding another identity.
4. If `settings.accountVerifyEndpoint` is configured:
   - POSTs the payload as JSON.
   - Adds a Bearer token using `settings.llmApiKey` when present.
   - Throws on an unsuccessful HTTP response.
   - Parses the JSON response and rejects an unauthorized result.
5. Saves `boundAccount` in storage.
6. Returns `{ ok: true, boundAccount: payload }`.

The background route is implemented, but no popup or options button calling `BIND_ACCOUNT` was identified in the current UI. Because `boundAccount` gates every LLM call, this previously made the LLM features unreachable for all users. See `autoBindLocalAccount` below for how local mode now resolves this.

### `autoBindLocalAccount(account)`

Called from `learning-controller` init before the quiz extractor mounts:

1. Returns the existing `boundAccount` if already set (never overwrites).
2. Returns `null` when `accountVerifyEndpoint` is non-empty — a real deployment must still require explicit binding so the API can approve the account.
3. Returns `null` when the account is not `authenticated` or is missing `accountId`/`hostname`.
4. Otherwise writes `boundAccount` to storage and returns it.

In local mode (`accountVerifyEndpoint === ''`) there is no API to verify against, so a successful LMS login is treated as sufficient and no consent click is required.

## 8. Provider Architecture

A provider adapts shared learning logic to a particular LMS DOM. The current interface includes:

| Member | Responsibility |
| --- | --- |
| `id` | Provider identifier. |
| `matches(location)` | Determines whether the provider supports the page. |
| `findVideo(document)` | Finds an accessible video element. |
| `findVideoFrame(document)` | Finds a video iframe when a video element is not accessible; invoked optionally by the controller. |
| `findNextButton(document)` | Finds the next-lesson button or link. |
| `findDiscussionInput(document)` | Finds a discussion textarea; not directly used by the current controller. |
| `getAccount()` | Optional account-status detection. |
| `isLoginPage(location)` | Optional login-page detection. |
| `login({ username, password })` | Optional login-form filling and submission. |

File: `src/providers/provider-registry.js`.

### `resolveProvider(location)`

Checks the registered providers in order:

```js
const providers = [pttc1Provider, genericLmsProvider];
```

Returns the first provider whose `matches(location)` succeeds, or `null` when none matches. Order matters: PTTC1 precedes the generic provider so its dedicated behavior takes priority.

### Adding Another LMS

1. Create `src/providers/<name>.provider.js`.
2. Implement the relevant provider methods.
3. Register the provider before `genericLmsProvider` if it targets a specific LMS.
4. Keep LMS-specific selectors in the provider; shared controller logic should call provider methods.

## 9. PTTC1 Provider

File: `src/providers/pttc1.provider.js`.

### Constants

- `HOSTNAME = 'lms.pttc1.edu.vn'`.
- `VIDEO_FRAME_PATTERN`: recognizes iframe/player sources for YouTube, Vimeo, Dailymotion, JWPlayer, Flowplayer, Brightcove, and `.m3u8`, `.mp4`, or `.webm` media.

### `text(selector)`

Returns the trimmed `textContent` of the first matching element in `document`, or an empty string when no element exists.

### `videoFrames(doc)`

Collects iframes in `doc` whose `src` matches `VIDEO_FRAME_PATTERN`.

### `frameVideoIn(frame)`

Attempts `frame.contentDocument?.querySelector('video')`. Catches access errors, including cross-origin restrictions, and returns `null` when no accessible video is found.

### `pttc1Provider.matches(location)`

Returns whether `location.hostname === 'lms.pttc1.edu.vn'`.

### `pttc1Provider.getAccount()`

Detects the Moodle user:

- Searches for `[data-userid], #usermenu, .usermenu`.
- Derives `accountId` from `dataset.userid` or `.usermenu .usertext, .usermenu .username` text.
- Without an identity, returns `{ authenticated: false, hostname: HOSTNAME }`.
- With an identity, returns `{ authenticated: true, accountId, displayName, hostname }`.

### `pttc1Provider.isLoginPage(location)`

Matches `/login/index.php`.

### `pttc1Provider.login({ username, password })`

- Finds the username input through `#username, input[name="username"]`.
- Finds the password input through `#password, input[name="password"]`.
- Finds the form through `#login, form[action*="login"]`.
- Returns `{ ok: false, reason: 'login-form-not-found' }` if required elements are missing.
- Returns `{ ok: false, reason: 'captcha-required' }` if CAPTCHA or reCAPTCHA is detected.
- Assigns credentials, dispatches `input` events, and calls `form.requestSubmit()`.
- Returns `{ ok: true }` after initiating submission; this does not itself confirm that the server accepted the login.

### `pttc1Provider.findVideo(doc)`

Prefers a video in the main document, then attempts accessible iframe videos through `frameVideoIn`. Returns `null` if none is found.

### `pttc1Provider.findVideoFrame(doc)`

Returns `null` if the document already contains a video. Otherwise returns the first recognized video iframe, allowing the controller to detect a player even when its inner DOM is inaccessible.

### `pttc1Provider.findNextButton(document)`

Searches these candidates:

- `#next-activity-link`.
- `a[rel="next"]`.
- `.activity-navigation a`.
- `[data-region="activity-navigation"] a`.
- Buttons with a next-related English or Vietnamese `aria-label`.

Prefers a candidate whose text or label matches the next-related regular expression. Falls back to the last candidate, then `null` if no candidate exists. Vietnamese selector and regular-expression text appeared garbled in terminal output and should be verified before changing matching behavior.

### `pttc1Provider.findDiscussionInput(document)`

Uses:

```css
textarea[name*="message" i], textarea[name*="comment" i]
```

## 10. Generic LMS Provider

File: `src/providers/generic-lms.provider.js`.

### `genericLmsProvider.matches(location)`

Matches when the hostname and pathname contain a keyword such as `course`, `learn`, `lesson`, `lms`, or `training`.

### `findVideo(document)` and `findVideoFrame(document)`

Use behavior similar to PTTC1: find a main-document video, attempt accessible iframe videos, and otherwise identify a recognized player iframe through its source URL.

### `findNextButton(document)`

Uses generic selectors:

- `[data-testid="next-lesson"]`.
- `a[rel="next"]`.
- Buttons with an `aria-label` containing `Next`.
- Buttons with a Vietnamese next-related `aria-label`; this text appeared garbled in terminal output.

### `findDiscussionInput(document)`

Finds a textarea whose name contains `discussion` or `comment`.

## 11. Content Entry and Learning Controller

File: `entrypoints/content.js`.

- Matches `https://*/*`.
- Runs at `document_idle`.
- Its `main()` resolves the provider, returns early if none matches, and creates `createLearningController(provider)` otherwise.
- Registers a runtime listener delegating to `controller.handleMessage(message)`.
- Listens for `extensionEnabled` storage changes and calls `controller.setEnabled(...)`, so the master switch takes effect without reloading the page.

File: `src/content/learning-controller.js`.

This module coordinates page automation.

### Constants and Helpers

- `ACTION_DELAY_MS = 500`: delay before a DOM action.
- `NEXT_LESSON_DELAY_MS = 2000`: delay before next-lesson navigation.
- `MANUAL_PATHS = ['/mod/forum/', '/mod/quiz/']`: pages requiring user interaction.
- `needsManualAction()`: checks whether the current path starts with a manual path.

### `createLearningController(provider)`

Creates a controller with internal state:

- `observer`: watches DOM mutations.
- `coursePanelTimer`: debounces course-panel synchronization.
- `coursePanelSynced`: prevents repeated dashboard synchronization.
- `nextLessonTimer`: pending next-lesson timer.
- `nextLessonSource`: remembers the source already scheduled.
- `enabled`: master-switch state.

The following functions are internal to the controller unless listed in its public API.

### `allowedHere()`

Reads `allowedDomains`. Allows the page when the list is empty; otherwise requires an exact `location.hostname` match using `includes`.

### `nextLesson()`

1. Returns `{ ok: false, reason: 'extension-disabled' }` when disabled.
2. On a forum page, mounts the forum helper and returns `{ ok: false, reason: 'forum-requires-user' }`.
3. On another manual path, returns `{ ok: false, reason: 'requires-user' }`.
4. For a disallowed domain, returns `{ ok: false, reason: 'domain-not-allowed' }`.
5. Waits 500 ms.
6. Finds the next button through the provider.
7. Returns `{ ok: false }` if the button is missing or disabled.
8. Clicks the button and returns `{ ok: true }`.

### `scheduleNextLesson(source)`

Schedules `nextLesson()` after two seconds. Ignores an already scheduled source and clears any previous timer before scheduling a new source.

### `startAutoResume()`

Calls `markAutoResumeAfterLogin()` and `resumeLowestProgressCourse()`, then returns `{ ok: true }`.

### `watchFrameLoad(frame)`

Marks an iframe with `frame.dataset.vernalFrameWatch = 'true'` to avoid duplicate listeners. Registers a one-time load listener that invokes `watchCurrentVideo()` again when the frame loads.

### `watchCurrentVideo()`

1. Returns when disabled or on a manual-action page.
2. Reads `autoPlayVideo` and `autoNextLesson`.
3. Returns when both are false or the domain is disallowed.
4. Looks for a video through `provider.findVideo(document)`:
   - When a video is found, the current implementation mutes it and attempts playback if paused, swallowing playback rejection.
   - Otherwise tries `provider.findVideoFrame?.(document)` and watches the frame load.
5. When `autoNextLesson` is true and a next button exists, calls `scheduleNextLesson(document.body)`.

The current video branch is reached when either automation setting is enabled. Review this branch when changing playback behavior; do not assume `autoPlayVideo` independently guards every playback action. Automatic next-lesson navigation does not wait for the video to finish.

### `loginWithSavedCredentials()`

Reads settings, verifies the provider recognizes a login page and saved credentials exist, waits 500 ms, then calls `provider.login({ username, password })`. If the provider reports success and `autoResumeCourse` is enabled, marks the resume flow. Returns the login result.

### `tryResumeCourse()`

Calls `resumeLowestProgressCourse()` when the controller is enabled and `autoResumeCourse` is true.

### `observePage()`

Creates a `MutationObserver` on `document.documentElement` with `subtree` and `childList` enabled. On DOM changes:

- Returns when disabled.
- Calls `watchCurrentVideo()` and `tryResumeCourse()`.
- On `/my/` pages, when course cards exist and the panel has not been synchronized, debounces for 350 ms, reads settings, marks synchronization complete, and calls `syncCourseStatusPanel(settings.showCourseStatus)`.

Calls `watchCurrentVideo()` immediately after registering the observer.

### `setEnabled(value)`

Returns if the value is unchanged. Otherwise updates `enabled`, clears timers, and resets next-lesson source and panel synchronization state.

- Disabling disconnects the observer and hides the course panel.
- Enabling starts observation, mounts the forum helper, attempts course resumption, and synchronizes the panel according to settings.

### Initial Setup

The controller asynchronously reads settings during creation:

- Sets `enabled = settings.extensionEnabled !== false`.
- If disabled, hides the panel and stops initialization.
- If enabled, starts observation, mounts the forum helper, attempts resumption, and synchronizes the panel.
- When `pttc1AutoLogin` is enabled and the provider reports no authenticated account, attempts saved-credential login.

### Public API

The returned object exposes `handleMessage`, `setEnabled`, and `destroy`.

`handleMessage(message)` handles:

| Message | Result or Action |
| --- | --- |
| `COURSE_STATUS` | Returns `{ supported: true, provider: provider.id, enabled }`. |
| `ACCOUNT_STATUS` | Returns `provider.getAccount?.() ?? { authenticated: false }`. |
| `NEXT_LESSON` | Calls `nextLesson()`. |
| `LOGIN_WITH_SAVED_CREDENTIALS` | Attempts login when enabled; otherwise returns a disabled reason. |
| `REFRESH_COURSE_PANEL` | Returns `{ ok: true, enabled: false }` when disabled; otherwise synchronizes the panel from settings. |
| `START_AUTO_RESUME` | Starts resumption when enabled; otherwise returns a disabled reason. |
| Other messages | Returns `undefined`. |

`setEnabled(value)` changes controller state as described above. `destroy()` disconnects the observer and clears timers.

## 12. Auto-Resume Flow

File: `src/content/auto-resume.js`.

Stores the current flow phase in page `sessionStorage`.

### Constants and Helpers

- `FLOW_KEY = 'vernal:auto-resume-phase'`.
- `COURSES_PATH = '/my/courses.php'`.
- `navigateAfterDelay(url)`: calls `location.assign(url)` after 500 ms.
- `courseCards()`: selects `.card.dashboard-card, .coursebox, [data-region="course-content"] .card`.

### `getProgress(card)`

Prefers `aria-valuenow` or `style.width` from `[aria-valuenow], .progress-bar`. Otherwise parses an `x trong y` or `x of y` completion count from `.progress-text`, `[data-region="progress-text"]`, or `.text-muted`. Falls back to `100` when progress cannot be determined.

### `markAutoResumeAfterLogin()`

Sets `sessionStorage[FLOW_KEY] = 'courses'`.

### `resumeLowestProgressCourse()`

Implements a two-phase state machine:

1. Reads the phase; returns `false` when no flow is active.
2. In the `courses` phase:
   - Navigates to `/my/courses.php` if necessary and returns `true`.
   - On that page, collects cards with `/course/view.php?id=` links.
   - Returns `false` if cards have not loaded yet.
   - Sorts by ascending progress, changes the phase to `video`, and navigates to the lowest-progress course.
   - Returns `true` after initiating navigation.
3. In the `video` phase on `/course/view.php`:
   - Finds the first link containing `/mod/videotime/view.php?id=`.
   - Returns `false` if none exists.
   - Removes the flow key, navigates to that video, and returns `true`.
4. Returns `false` for other states.

This flow chooses the first matching video activity, not necessarily the first unfinished activity.

## 13. Forum Helper

File: `src/content/forum-helper.js`.

Displays a floating helper on forum pages. It generates a draft, opens a posting form, fills its subject and question, and shows the suggested answer for review. It does not submit the post.

### `HELPER_ID`

`'vernal-forum-helper'`.

### `extractDraft(response)`

Extracts raw content from `response.choices[0].message.content`, `response.content`, or `response.draft`, falling back to an empty string.

### `parseDraft(response)`

Extracts content, strips surrounding JSON code fences if present, parses JSON, and requires `title`, `question`, and `answer`. Throws for malformed JSON or missing fields; otherwise returns the draft object.

### `getLearningContext()`

Reads breadcrumbs using `.breadcrumb-item` and `[aria-label="breadcrumb"] li`.

- `courseName`: uses the next-to-last breadcrumb or `.course-title, #page-header h1`.
- `chapterName`: uses the last breadcrumb or `#page-header h1, h1`.

### `applyPendingForumDraft()`

1. Runs only on paths beginning with `/mod/forum/post.php`.
2. Reads `vernalForumDraft` from extension local storage.
3. Finds the subject using `#id_subject, input[name="subject"]`.
4. Finds the message using `textarea[name="message"], textarea[name*="message" i], textarea`.
5. Returns `false` if the draft or required fields are missing.
6. Sets the subject to `draft.title` and the message to `draft.question`.
7. Dispatches `input` events for both fields.
8. Removes `vernalForumDraft` from storage.
9. Inserts a review note containing `draft.answer` before the nearby message form group. The Vietnamese note text appeared garbled in terminal output.
10. Returns `true`.

### `mountForumHelper()`

1. Returns outside `/mod/forum/` paths.
2. Calls `applyPendingForumDraft()`.
3. Returns if the helper already exists or the user is on the posting form.
4. Creates a bottom-right fixed `<aside>` with `HELPER_ID` and inline styles.
5. On the generate button click:
   - Disables the button and displays a loading state.
   - Reads context from `#region-main` or `document.body`, limited to 5,000 characters.
   - Extracts the course and chapter names.
   - Sends the following runtime message:

```js
{
  type: 'GENERATE_DISCUSSION',
  payload: { courseName, chapterName, topic: document.title, context }
}
```

6. Parses the response and saves `{ vernalForumDraft: draft }`.
7. Finds a new-topic link using `a[href*="/mod/forum/post.php?forum="]` or the fallback `a[href*="discuss.php?"]` and navigates when a link is available.
8. On failure, re-enables the button and displays the error on it.

## 14. Course Status Panel

File: `src/content/course-status-panel.js`.

### `PANEL_ID`

`'vernal-course-status'`.

### `escapeHtml(value)`

Escapes `&`, `<`, `>`, single quotes, and double quotes before inserting values into HTML templates. Assumes its argument is a string; current callers provide string fallbacks for course titles, URLs, and completion text.

### `extractCourses()`

Reads up to 12 course cards using `.card.dashboard-card, .coursebox, [data-region="course-content"] .card`. Returns an object for each card:

- `title`: course-link text, `.coursename`, `.card-title`, `h3`, `h4`, or a numbered course fallback.
- `url`: course-link URL or an empty string.
- `percent`: progress from `aria-valuenow`, `style.width`, or `x trong y` / `x of y` text, clamped to 0-100.
- `completionText`: original progress text.

### `syncCourseStatusPanel(enabled)`

Removes an existing panel first. Returns if disabled or outside `/my/` pages. Otherwise extracts courses, creates a bottom-right fixed aside with inline CSS, renders course links and progress bars, adds a close button, and appends the panel to the body. Closing removes the current panel.

## 15. Popup UI

File: `entrypoints/popup/main.jsx`.

Uses React and a Chakra provider. Its main components are `Popup` and `InlineSettings`.

### `Popup()`

State includes `status`, `powerOn`, `autoPlayVideo`, `showCourseStatus`, `autoNextLesson`, `autoLogin`, and `screen` (`'home'` or `'settings'`). `powerOn` maps to `extensionEnabled !== false`; `autoLogin` maps to `pttc1AutoLogin`.

On mount, calls `refresh()`. A storage listener updates `powerOn` when `extensionEnabled` changes.

### `refresh()`

Reads settings and updates toggles, obtains the active tab, and requests `COURSE_STATUS`. For unsupported pages, displays a prompt to open the PTTC1 LMS. Otherwise requests `ACCOUNT_STATUS` and displays either the account name/ID or a login prompt for the detected provider.

### `login()`

Handles the resume-learning button:

1. Gets the active tab and requests account status.
2. If authenticated, sends `START_AUTO_RESUME`, displays a lowest-progress-course search status, and returns.
3. If the tab is not the PTTC1 login page, opens `https://lms.pttc1.edu.vn/login/index.php` in a new tab, updates status, and returns.
4. On the login page, sends `LOGIN_WITH_SAVED_CREDENTIALS` and displays the result, including CAPTCHA or missing-form/credential feedback.

### Toggle Functions

| Function | Behavior |
| --- | --- |
| `togglePower()` | Inverts and saves `extensionEnabled`, then updates status. The content storage listener applies the change. |
| `toggleAutoPlay()` | Inverts and saves `autoPlayVideo`, then updates status. |
| `toggleCourseStatus()` | Inverts and saves `showCourseStatus`, then sends `REFRESH_COURSE_PANEL` to the active tab. |
| `toggleAutoNext()` | Inverts and saves `autoNextLesson`. |
| `toggleAutoLogin()` | Inverts and saves `pttc1AutoLogin`. |

The home screen contains the Vernal header and power button, status indicators, account status, course-panel/video/next-lesson/auto-login toggles, and buttons for resuming learning and opening inline AI settings.

### `InlineSettings({ onBack })`

Provides settings inside the popup. Its form fields are `pttc1Username`, `pttc1Password`, `pttc1AutoLogin`, `llmModel`, and `llmApiKey`.

On mount, loads saved settings but clears the displayed password and API-key fields so stored secrets are not shown.

### `save(event)`

Prevents form submission, separates the password and API key, and patches the remaining fields. Writes secrets only when the corresponding new input is nonempty, then clears those inputs and sets `saved = true`. Leaving a secret field blank preserves its stored value.

## 16. Options UI

File: `entrypoints/options/main.jsx`.

### `Options()`

Maintains `form`, initially `DEFAULT_SETTINGS`, and `saved`. On mount, reads settings into the form while clearing the displayed password and API key.

### `submit(event)`

1. Prevents default submission.
2. Separates the password and API key from other fields.
3. Saves the remaining fields, saves secrets only if new nonempty values were entered, and converts the `allowedDomains` textarea into an array by splitting lines, trimming, and filtering empty entries.
4. Clears secret inputs and sets the saved indicator.

The screen includes PTTC1 identity fields and an auto-login toggle, AI model and authentication fields, and an allowed-domains textarea with one hostname per line.

The options UI does not provide complete editing controls for `accountVerifyEndpoint`, `boundAccount`, `autoNextLesson`, `autoPlayVideo`, `showCourseStatus`, `autoResumeCourse`, or `autoStartQuiz`. Some of these are available in the popup; others exist only in settings or service code.

## 17. Styling

File: `src/ui/globals.css`.

- Imports Tailwind.
- Defines the global dark navy and mint theme.
- Includes shared classes such as `.ai-shell`, `.ai-grid`, `.glass-card`, `.brand-orb`, `.eyebrow`, `.status-panel`, and `.pulse-dot`.
- Includes controls such as `.ai-button`, `.ai-input`, `.field-label`, `.section-card`, and `.switch`.
- Defines compact popup classes including `.reference-popup`, `.reference-panel`, `.reference-logo`, `.reference-power`, `.reference-stat`, `.reference-row`, and `.reference-switch`.

File: `src/ui/settings-theme.css`.

- Styles the options page through `.settings-page`, `.settings-panel`, `.settings-intro`, and `.settings-form`.
- Overrides shared section, input, switch, label, and button styles.
- Uses a responsive desktop grid.

## 18. Important Message and Data Flows

### Popup Page Detection

```text
Popup.refresh()
  -> settingsStore.get()
  -> getActiveTab()
  -> sendToActiveTab(COURSE_STATUS)
  -> controller.handleMessage()
  -> sendToActiveTab(ACCOUNT_STATUS)
  -> provider.getAccount()
```

### Master Switch

```text
Popup.togglePower()
  -> settingsStore.patch({ extensionEnabled })
  -> browser.storage.onChanged in content.js
  -> controller.setEnabled()
  -> update observer, timers, and course panel
```

### Video and Next-Lesson Automation

```text
MutationObserver / initial observePage()
  -> watchCurrentVideo()
  -> provider.findVideo() / provider.findVideoFrame()
  -> video.play() when the current video branch attempts playback
  -> provider.findNextButton()
  -> scheduleNextLesson()
  -> nextLesson()
  -> button.click()
```

### Course Resumption

```text
Popup.login()
  -> authenticated account: START_AUTO_RESUME
  -> markAutoResumeAfterLogin(): phase = "courses"
  -> resumeLowestProgressCourse()
  -> /my/courses.php
  -> select the lowest-progress course
  -> /course/view.php?id=...
  -> select the first /mod/videotime/view.php?id=... link
```

### Forum Draft Generation

```text
Forum page
  -> mountForumHelper()
  -> user clicks generate
  -> browser.runtime.sendMessage(GENERATE_DISCUSSION)
  -> background handleMessage()
  -> generateDiscussionDraft()
  -> parseDraft()
  -> storage.local.set({ vernalForumDraft })
  -> navigate to the forum posting form
  -> applyPendingForumDraft()
  -> fill subject/message and display the suggested answer
```

### Saved-Credential Login

```text
Popup.login() on the login page
  -> LOGIN_WITH_SAVED_CREDENTIALS
  -> controller.loginWithSavedCredentials()
  -> provider.login()
  -> form.requestSubmit()
  -> successful submission initiation + autoResumeCourse: mark resume flow
```

## 19. Security and Behavioral Boundaries

- Forum drafts are filled for user review; the extension does not automatically submit them.
- Forum and quiz paths require user interaction and are excluded from automatic next-lesson navigation.
- Usernames, passwords, and API keys are stored in `browser.storage.local`. The UI hides existing secrets by presenting blank fields, but this does not encrypt stored values.
- Account binding rejects a different identity when an existing binding is present.
- An empty `allowedDomains` list permits domain-gated automation on every matched provider. These checks are located in controller methods; do not assume the list restricts every feature globally.
- Host permissions and content-script matches cover every HTTPS page. Provider resolution determines where the controller initializes.
- Cross-origin iframe DOM access is restricted; providers can identify those players from their source URLs but cannot generally control their inner video elements.

## 20. Technical Observations and Possible Follow-Up Work

- Vietnamese strings appeared garbled when read through the terminal. Check actual UTF-8 content and terminal decoding before modifying UI strings or selectors.
- `DEFAULT_SETTINGS.llmEndpoint` and `.env.example` suggest a configurable endpoint, but `llm-client.js` uses `VILAO_CHAT_COMPLETIONS_URL` directly.
- `assistEnabled` and `autoStartQuiz` are present in settings without identified main-code usage.
- `BIND_ACCOUNT` has a background implementation without an identified UI binding flow. In local mode this is no longer blocking: `autoBindLocalAccount` sets the flag on a successful login. A deployment that configures `accountVerifyEndpoint` still has no UI to trigger `BIND_ACCOUNT`.
- Provider `findDiscussionInput` methods are not directly consumed by the controller; the forum helper queries the DOM itself.
- `autoNextLesson` schedules using `document.body` as its source. Activity changes in an SPA without a page reload may require resetting that source based on the URL or activity DOM.
- The current video branch may attempt playback with `autoNextLesson` enabled even when `autoPlayVideo` is false; inspect this before relying on independent toggles.
- The course panel and forum helper inject inline CSS, which complicates shared theming and visual testing.
- `escapeHtml(value)` assumes a string; future callers supplying other types will need conversion or validation.
- `message-router.handleMessage` does not catch service errors, so runtime-message promises can reject. Callers are expected to handle their own rejections (`forum-helper` and the quiz extractor's AI suggestion both do). The background listener in `entrypoints/background.js` attaches a no-op `.catch()` to the returned promise so the service worker does not also log the rejection as an uncaught error, while still returning the original promise so the caller's `sendMessage` rejects normally.

## 21. Maintenance Conventions

- Keep LMS-specific DOM selectors in provider modules.
- Keep shared automation in `learning-controller.js`; providers locate elements and perform LMS-specific actions such as login.
- Preserve user review for forum content and manual interaction on quiz pages.
- When adding a setting, define its default, add UI controls if needed, and add storage-change handling or a refresh message if it must take effect immediately.
- Preserve the LLM JSON contract `{ title, question, answer }` unless updating `parseDraft` and its consumers together.
- Auto-resume state uses page `sessionStorage` rather than persistent extension storage; account for tab/session lifecycle when changing the flow.
- Moodle may load course cards asynchronously. A `false` return from the resume function can mean the DOM is not ready rather than an error.

## 22. Functionality-to-File Map

| Functionality | Main File |
| --- | --- |
| Build and manifest | `wxt.config.js` |
| Message types and default settings | `src/shared/constants.js` |
| Settings storage | `src/shared/settings-store.js` |
| Active-tab and tab-message helpers | `src/shared/browser.js` |
| Background runtime listener | `entrypoints/background.js` |
| Background message routing | `src/background/message-router.js` |
| LLM draft generation | `src/services/llm-client.js` |
| Account binding | `src/services/account-binding.js` |
| Content-script entry | `entrypoints/content.js` |
| Main automation controller | `src/content/learning-controller.js` |
| Course resumption | `src/content/auto-resume.js` |
| Forum draft helper | `src/content/forum-helper.js` |
| Course-progress panel | `src/content/course-status-panel.js` |
| Provider registry | `src/providers/provider-registry.js` |
| PTTC1 Moodle provider | `src/providers/pttc1.provider.js` |
| Generic LMS provider | `src/providers/generic-lms.provider.js` |
| Popup UI | `entrypoints/popup/main.jsx` |
| Options UI | `entrypoints/options/main.jsx` |
| Shared UI CSS | `src/ui/globals.css` |
| Options CSS | `src/ui/settings-theme.css` |
