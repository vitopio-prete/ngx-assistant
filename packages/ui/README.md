# Styled components

Ready-made chat components for `@ngx-assistant/angular`, styled with Tailwind CSS v4. They are not
a library to import: you copy them into your app and change them there, so the markup, the classes
and the texts are yours. This folder is their source, with their tests and a preview page.

## What is here

| File                                 | Component                 | What it does                                                                                                            |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `thread/thread.ts`                   | `<nxa-thread>`            | The whole chat: welcome screen, messages, a viewport that follows the reply, a button back to the bottom, the composer. |
| `thread/thread-welcome.ts`           | `<nxa-thread-welcome>`    | The greeting of an empty thread and its suggestions.                                                                    |
| `thread/composer.ts`                 | `<nxa-composer>`          | Message field, attachments (picked, pasted or dropped), Send and Stop.                                                  |
| `thread/user-message.ts`             | `<nxa-user-message>`      | A user message as typed, its attachments, Edit and Copy, the branch picker.                                             |
| `thread/assistant-message.ts`        | `<nxa-assistant-message>` | A reply: markdown, reasoning, tool calls, files, the error of a failed run, its actions, the branch picker.             |
| `thread/edit-composer.ts`            | `<nxa-edit-composer>`     | The edit form that replaces a user message while it is edited.                                                          |
| `thread/markdown-text.ts`            | `<nxa-markdown-text>`     | Text as markdown (markdown-it, raw HTML shown as text), revealed smoothly while it streams.                             |
| `thread/reasoning.ts`                | `<nxa-reasoning>`         | Consecutive reasoning parts in one disclosure, open while the model reasons.                                            |
| `thread/tool-fallback.ts`            | `<nxa-tool-fallback>`     | A tool call without a UI of its own: status, duration, arguments, result, and the controls that answer it.              |
| `thread/tool-approval.ts`            | `<nxa-tool-approval>`     | The approval request of a tool call: decision, options with confirmation, typed answer, questionnaire, then a receipt.  |
| `thread/attachment.ts`               | `<nxa-attachment>`        | An attachment tile with an image preview.                                                                               |
| `thread/branch-picker.ts`            | `<nxa-branch-picker>`     | `‹ 2 / 3 ›` between the branches of a message.                                                                          |
| `thread/message-error.ts`            | `<nxa-message-error>`     | The error of a message, announced when it appears.                                                                      |
| `thread/message-file.ts`             | `<nxa-message-file>`      | An image or file part of a message.                                                                                     |
| `thread/focus-keeper.ts`             | `[nxaFocusKeeper]`        | Moves the keyboard focus to the next control when the focused one goes away.                                            |
| `thread-list/thread-list.ts`         | `<nxa-thread-list>`       | A sidebar list: New Thread, a search, the threads grouped by day, Load more, the archived threads.                      |
| `thread-list/thread-list-item.ts`    | `<nxa-thread-list-item>`  | A row: the title, a spinner while the thread runs, a menu with Rename, Archive, Delete (Restore for an archived one).   |
| `assistant-modal/assistant-modal.ts` | `<nxa-assistant-modal>`   | A floating chat: a button in the corner opens the thread and a Threads view; resizable, opens when a reply starts.      |
| `model-selector/model-selector.ts`   | `<nxa-model-selector>`    | The chosen model and effort, and a panel to pick them; the choice goes to every run.                                    |
| `tool-ui/approval-card.ts`           | `<nxa-approval-card>`     | A ready approval request for a tool UI of your own: title, command, details, Allow / Deny, then a receipt.              |
| `menu/menu.ts`                       |                           | The classes and positions of the menus.                                                                                 |
| `icons.ts`                           | `<nxa-icon>`              | The inline SVG icons.                                                                                                   |
| `styles/nxa-theme.css`               |                           | The theme tokens, light and dark, and the markdown typography.                                                          |

Every file depends only on `@ngx-assistant/angular` (and its engine, for a few types), Angular,
`@angular/cdk` (menus and overlay), `markdown-it` and Tailwind.

## Use them

`ng add @ngx-assistant/angular` sets up Tailwind CSS v4 and copies the thread into
`src/app/chat`. Each component group also has its own generator, which copies its files and the
ones it uses (the icons, the theme, the menu), adds the packages they import and imports the theme
in the global stylesheet:

| Generator                                     | Copies                                                  |
| --------------------------------------------- | ------------------------------------------------------- |
| `ng g @ngx-assistant/angular:thread`          | `thread/`, `menu/`                                      |
| `ng g @ngx-assistant/angular:thread-list`     | `thread-list/`, `menu/`                                 |
| `ng g @ngx-assistant/angular:assistant-modal` | `assistant-modal/`, with the thread and the thread list |
| `ng g @ngx-assistant/angular:model-selector`  | `model-selector/`                                       |
| `ng g @ngx-assistant/angular:approval-card`   | `tool-ui/approval-card.ts`                              |

They take `--path` (the folder, relative to the source root, `app/chat` by default) and
`--project`. A file you changed is kept when a generator runs again and the generator lists it;
`--overwrite` replaces it with the version of the installed package. The generators copy this
folder's `src/lib` without its tests, as it is: a test of the schematics checks that every file
here belongs to a generator.

Without the schematics:

1. Install Tailwind v4 for Angular (`tailwindcss`, `@tailwindcss/postcss` and a `.postcssrc.json`
   with the plugin), `@angular/cdk` and `markdown-it`.
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
`<nxa-tool-fallback>` otherwise. A tool UI of your own can ask for approval with
`<nxa-approval-card>`:

```ts
@Component({
  imports: [NxaApprovalCard],
  template: `<nxa-approval-card
    title="Delete the file"
    subtitle="Needs your approval"
    [command]="'rm ' + call.args().path"
    variant="destructive"
  />`,
})
class DeleteFileUi {
  protected readonly call = injectToolCall<{ path: string }>();
}
// providers: [provideToolUi({ toolName: 'delete_file', component: DeleteFileUi })]
```

### Thread list, modal and model selector

`<nxa-thread-list>` and `<nxa-assistant-modal>` need a runtime with a thread list, such as
`provideRemoteThreadListRuntime(...)` (with a single-thread runtime the list stays empty).
Put the list beside the thread, or the modal anywhere in the page:

```html
<div class="flex h-dvh">
  <aside class="w-64 p-2"><nxa-thread-list /></aside>
  <nxa-thread class="flex-1" />
</div>

<nxa-assistant-modal />
```

`<nxa-model-selector [models]="models" [(value)]="model" />` puts the chosen model (and effort) in
the model context of the runtime, so every run asks for it. `side="top"` opens its panel above it,
and `variant="ghost"` makes it a compact button without a background. A model with `icon` (an
image URL) shows it beside its name; `<ng-template nxaModelSelectorIcon let-model>` inside the
selector draws the icons instead, for inline SVG. A model with `disabled: true` stays in the list,
dimmed, with its `description` as the reason (for example "Sign in to use").

`nxa-composer`, `nxa-thread` and `nxa-assistant-modal` put the elements marked `nxaComposerTools`
in the composer, after the attachment button:

```html
<nxa-thread>
  <nxa-model-selector nxaComposerTools variant="ghost" side="top" [models]="models" />
</nxa-thread>
```

The menus and the modal open in the overlay of `@angular/cdk`, at the end of the body: the theme
imports its stylesheet. They follow the tokens set on the root, not those set on an element, and
turn dark only with the `dark` class or `data-theme="dark"` on the root.

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
- The menus (`@angular/cdk/menu`) open with Enter, Space or the arrows, move with the arrows,
  Home, End and typeahead, and close with Escape back to their button.
- The assistant modal is a `dialog` named by its title. It is not modal: a click outside leaves
  it open; Escape and its button close it and give the focus back to the button. Its resize handle
  works with the arrow keys (Shift for bigger steps) and resets with Enter.
- The approval card is a `group` named by its title; Escape never denies. Its status is a live
  region: it says when an answer is on its way, holding the focus of the answer (given back if the
  answer is refused), then announces the receipt.

## Work on them

- `ng serve ui` opens the preview, a thread on a model that runs in the page, with a thread list
  kept in the page. Ask it for `/reasoning`, `/tool`, `/approval`, `/approval-card`, `/question`
  or `/error`, attach files, switch between the sidebar and the modal layout and the theme.
- `ng test ui` runs the tests: rendering, behavior, focus, and axe checks.
- `ng build ui` builds the preview, which checks that Tailwind compiles every class.
