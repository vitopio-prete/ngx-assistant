# Styled components

Ready-made chat components for `@ngx-assistant/angular`, styled with Tailwind CSS v4. They are not
a library to import: you copy them into your app and change them there, so the markup, the classes
and the texts are yours. This folder is their source, with their tests and a preview page.

## What is here

| File                          | Component                 | What it does                                                                                                            |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `thread/thread.ts`            | `<nxa-thread>`            | The whole chat: welcome screen, messages, a viewport that follows the reply, a button back to the bottom, the composer. |
| `thread/thread-welcome.ts`    | `<nxa-thread-welcome>`    | The greeting of an empty thread and its suggestions.                                                                    |
| `thread/composer.ts`          | `<nxa-composer>`          | Message field, attachments (picked, pasted or dropped), Send and Stop.                                                  |
| `thread/user-message.ts`      | `<nxa-user-message>`      | A user message as typed, its attachments, Edit and Copy, the branch picker.                                             |
| `thread/assistant-message.ts` | `<nxa-assistant-message>` | A reply: markdown, reasoning, tool calls, files, the error of a failed run, Copy and Regenerate, the branch picker.     |
| `thread/edit-composer.ts`     | `<nxa-edit-composer>`     | The edit form that replaces a user message while it is edited.                                                          |
| `thread/markdown-text.ts`     | `<nxa-markdown-text>`     | Text as markdown (markdown-it, raw HTML shown as text), revealed smoothly while it streams.                             |
| `thread/reasoning.ts`         | `<nxa-reasoning>`         | Consecutive reasoning parts in one disclosure, open while the model reasons.                                            |
| `thread/tool-fallback.ts`     | `<nxa-tool-fallback>`     | A tool call without a UI of its own: status, duration, arguments, result, and the controls that answer it.              |
| `thread/tool-approval.ts`     | `<nxa-tool-approval>`     | The approval request of a tool call: decision, options with confirmation, typed answer, questionnaire, then a receipt.  |
| `thread/attachment.ts`        | `<nxa-attachment>`        | An attachment tile with an image preview.                                                                               |
| `thread/branch-picker.ts`     | `<nxa-branch-picker>`     | `‹ 2 / 3 ›` between the branches of a message.                                                                          |
| `thread/message-error.ts`     | `<nxa-message-error>`     | The error of a message, announced when it appears.                                                                      |
| `thread/message-file.ts`      | `<nxa-message-file>`      | An image or file part of a message.                                                                                     |
| `thread/focus-keeper.ts`      | `[nxaFocusKeeper]`        | Moves the keyboard focus to the next control when the focused one goes away.                                            |
| `icons.ts`                    | `<nxa-icon>`              | The inline SVG icons.                                                                                                   |
| `styles/nxa-theme.css`        |                           | The theme tokens, light and dark, and the markdown typography.                                                          |

Every file depends only on `@ngx-assistant/angular` (and its engine, for a few types), Angular,
`markdown-it` and Tailwind.

## Use them

1. Install Tailwind v4 for Angular (`tailwindcss`, `@tailwindcss/postcss` and a `.postcssrc.json`
   with the plugin) and `markdown-it`.
2. Copy `src/lib` into your app, for instance as `src/app/chat`.
3. Import the theme after Tailwind in your global stylesheet:

   ```css
   @import 'tailwindcss';
   @import './app/chat/styles/nxa-theme.css';
   ```

4. Provide a runtime and render the thread in a container with a height:

   ```ts
   @Component({
     selector: 'app-chat',
     imports: [NxaThread],
     providers: [
       provideDataStreamRuntime({ api: '/api/chat' }),
       provideSuggestions(['What can you do?']),
     ],
     template: `<nxa-thread class="h-dvh" />`,
   })
   export class Chat {}
   ```

Tool calls use the UI registered with `provideToolUi(...)` when there is one, and
`<nxa-tool-fallback>` otherwise.

Markdown is rendered with `markdown-it` without raw HTML, and images in a reply show as links
rather than loading, so a reply cannot make the browser fetch a URL on its own. Change both in
`markdown-text.ts` if your model's output is trusted.

## Theme

The components use the `--nxa-*` tokens through Tailwind colors such as `bg-nxa-background` and
`text-nxa-muted-foreground`:

| Token                                       | Used for                                 |
| ------------------------------------------- | ---------------------------------------- |
| `--nxa-background`, `--nxa-foreground`      | The page and its text                    |
| `--nxa-muted`, `--nxa-muted-foreground`     | User bubbles, code, secondary text       |
| `--nxa-primary`, `--nxa-primary-foreground` | Send, Stop, the main button of a request |
| `--nxa-accent`, `--nxa-accent-foreground`   | Hover backgrounds                        |
| `--nxa-border`, `--nxa-ring`                | Borders and focus rings                  |
| `--nxa-destructive`                         | Errors                                   |
| `--nxa-radius`                              | The base radius                          |

Each token falls back to the variable of the same name of a shadcn or spartan theme whose
variables hold whole colors (`--background: oklch(1 0 0)`, as shadcn v4 themes do), so with such a
theme the components follow it without any change. A theme that stores bare HSL channels
(`--background: 0 0% 100%`) gives invalid colors: set the `--nxa-*` tokens instead. Without a theme
the components use their own neutral palette.

The tokens turn dark under the `dark` class or `data-theme="dark"` on the root, the convention of
those themes, and with the system preference while the root sets neither `light` nor
`data-theme="light"`. The theme does not change Tailwind's own `dark:` variant.

Set a token on any element to restyle what is below it, for example
`<nxa-thread style="--nxa-primary: oklch(0.55 0.2 260)" />`. The width of the conversation is
`--nxa-thread-max-width` (44rem).

## Accessibility

- Every icon button has an `aria-label`.
- The actions of a message show on hover and on keyboard focus: they stay in the tab order while
  hidden.
- The composer takes the focus when the thread appears, when a run starts and after switching
  thread; set `[autoFocus]="false"` on `<nxa-thread>` to leave the focus where it is.
- Reasoning and tool calls are disclosures with `aria-expanded`; a streaming reasoning is
  `aria-busy`.
- Errors are announced (`role="alert"`), and so is the writing indicator (`role="status"`).

## Work on them

- `ng serve ui` opens the preview, a thread on a model that runs in the page. Ask it for
  `/reasoning`, `/tool`, `/approval`, `/question` or `/error`, attach files, switch the theme.
- `ng test ui` runs the tests: rendering, behavior, focus, and axe checks.
- `ng build ui` builds the preview, which checks that Tailwind compiles every class.
