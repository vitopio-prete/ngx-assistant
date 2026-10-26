import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ExternalStoreAdapter,
  ThreadMessageLike,
  ToolCallMessagePart,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../../external-store-runtime';
import { NxaMessageParts } from '../../messages/message-parts';
import { NxaMessages } from '../../messages/messages';
import { provideToolUi } from '../tool-ui-registry';
import {
  NxaToolApprovalApprove,
  NxaToolApprovalConfirm,
  NxaToolApprovalConfirmCancel,
  NxaToolApprovalDeny,
  NxaToolApprovalDismiss,
  NxaToolApprovalOption,
  NxaToolApprovalSubmitText,
  NxaToolApprovalText,
} from './approval-controls';
import {
  NxaToolApprovalQuestionOption,
  NxaToolApprovalQuestionText,
  NxaToolApprovalQuestions,
  NxaToolApprovalSubmitAnswers,
} from './approval-questions';
import { NxaToolApprovalRoot, injectToolApproval } from './approval-root';

type Approval = NonNullable<ToolCallMessagePart['approval']>;

const gated = (
  approval: Approval,
  status: ThreadMessageLike['status'] = { type: 'requires-action', reason: 'tool-calls' },
): ThreadMessageLike => ({
  id: 'a1',
  role: 'assistant',
  content: [
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'delete_file',
      args: { path: '/tmp/a' },
      approval,
    },
  ],
  status,
});

interface StoreOptions {
  answers?: boolean;
}

function createStore(initial: readonly ThreadMessageLike[], options: StoreOptions = {}) {
  const messages = signal<readonly ThreadMessageLike[]>(initial);
  const onRespondToToolApproval = vi.fn<(options: unknown) => Promise<void> | void>();
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
      messages: messages(),
      convertMessage: (message) => message,
      onNew: async () => undefined,
      ...(options.answers !== false && { onRespondToToolApproval }),
    })),
  );
  return { messages, provider, onRespondToToolApproval };
}

type Store = ReturnType<typeof createStore>;

@Component({
  selector: 'nxa-test-approval',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaToolApprovalRoot,
    NxaToolApprovalApprove,
    NxaToolApprovalDeny,
    NxaToolApprovalOption,
    NxaToolApprovalConfirm,
    NxaToolApprovalConfirmCancel,
    NxaToolApprovalText,
    NxaToolApprovalSubmitText,
    NxaToolApprovalDismiss,
    NxaToolApprovalQuestions,
    NxaToolApprovalQuestionOption,
    NxaToolApprovalQuestionText,
    NxaToolApprovalSubmitAnswers,
  ],
  template: `
    <div nxaToolApprovalRoot #a="nxaToolApprovalRoot" class="root">
      <span class="receipt">{{ receipt(a) }}</span>
      <span class="error">{{ a.state.error() }}</span>
      <span class="options">{{ optionIds(a) }}</span>
      <span class="confirming">{{ a.state.confirming()?.id }}</span>
      <span class="answers">{{ answers(a) }}</span>
      <button nxaToolApprovalApprove class="approve">allow</button>
      <button nxaToolApprovalDeny class="deny">deny</button>
      @for (option of a.state.options(); track option.id) {
        <button [nxaToolApprovalOption]="option" [attr.data-test]="'option-' + option.id">
          {{ option.label ?? option.id }}
        </button>
      }
      <button nxaToolApprovalConfirm class="confirm">confirm</button>
      <button nxaToolApprovalConfirmCancel class="confirm-cancel">back</button>
      <textarea nxaToolApprovalText class="text"></textarea>
      <button nxaToolApprovalSubmitText class="submit-text">send</button>
      <button nxaToolApprovalDismiss class="dismiss">dismiss</button>
      <fieldset *nxaToolApprovalQuestions="let question" [attr.data-question]="question().id">
        @for (option of question().options ?? []; track option.id) {
          <button
            [nxaToolApprovalQuestionOption]="option.id"
            [attr.data-test]="question().id + '-' + option.id"
          >
            {{ option.label }}
          </button>
        }
        <textarea nxaToolApprovalQuestionText></textarea>
      </fieldset>
      <button nxaToolApprovalSubmitAnswers class="submit-answers">send</button>
    </div>
  `,
})
class ApprovalCard {
  receipt(root: NxaToolApprovalRoot) {
    const receipt = root.state.receipt();
    if (!receipt) return '';
    return [
      receipt.outcome,
      receipt.answered ? 'answered' : 'decided',
      receipt.automatic ? 'automatic' : 'user',
      receipt.option?.id ?? '-',
      receipt.notes.join('|'),
    ].join(',');
  }

  answers(root: NxaToolApprovalRoot) {
    return (root.state.receipt()?.answers ?? [])
      .map(
        (answer) =>
          `${answer.question.id}=${[...answer.options.map((o) => o.label), answer.text ?? ''].join('+')}`,
      )
      .join(';');
  }

  optionIds(root: NxaToolApprovalRoot) {
    return root.state
      .options()
      .map((option) => option.id)
      .join(',');
  }
}

function host(store: Store) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaMessages, NxaMessageParts],
    providers: [store.provider, provideToolUi({ fallback: ApprovalCard })],
    template: `<div *nxaMessages><ng-container *nxaMessageParts /></div>`,
  })
  class Host {}
  return Host;
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

async function mount(store: Store) {
  const fixture = TestBed.createComponent(host(store));
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

const el = <T extends HTMLElement = HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string,
) => (fixture.nativeElement as HTMLElement).querySelector<T>(selector)!;

const button = (fixture: ComponentFixture<unknown>, selector: string) =>
  el<HTMLButtonElement>(fixture, selector);

async function click(fixture: ComponentFixture<unknown>, selector: string) {
  button(fixture, selector).click();
  await settle(fixture);
}

async function type(fixture: ComponentFixture<unknown>, selector: string, value: string) {
  const field = el<HTMLTextAreaElement>(fixture, selector);
  field.value = value;
  field.dispatchEvent(new Event('input'));
  await settle(fixture);
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

const response = (store: Store, call = 0) => store.onRespondToToolApproval.mock.calls[call]![0];

afterEach(() => vi.restoreAllMocks());

describe('nxaToolApprovalRoot', () => {
  it('allows a pending decision', async () => {
    const store = createStore([gated({ id: 'req-1' })]);
    const fixture = await mount(store);
    expect(el(fixture, '.root').dataset['nxaApproval']).toBe('pending');
    expect(el(fixture, '.root').dataset['nxaDisplay']).toBe('decision');

    await click(fixture, '.approve');
    await flush();

    expect(store.onRespondToToolApproval).toHaveBeenCalledTimes(1);
    expect(response(store)).toEqual({ approvalId: 'req-1', approved: true });
  });

  it('denies with the typed note, when the request takes one', async () => {
    const store = createStore([gated({ id: 'req-1', allowFreeform: true })]);
    const fixture = await mount(store);

    await type(fixture, '.text', 'too risky');
    await click(fixture, '.deny');
    await flush();

    expect(response(store)).toEqual({ approvalId: 'req-1', approved: false, text: 'too risky' });
  });

  it('keeps the note field off for a decision that takes no typed answer', async () => {
    const store = createStore([gated({ id: 'req-1' })]);
    const fixture = await mount(store);
    expect(el<HTMLTextAreaElement>(fixture, '.text').disabled).toBe(true);
    expect(button(fixture, '.submit-text').disabled).toBe(true);
  });

  it('locks the controls once an answer is sent, until the request settles', async () => {
    const store = createStore([gated({ id: 'req-1' })]);
    const fixture = await mount(store);

    await click(fixture, '.approve');
    expect(el(fixture, '.root').dataset['nxaSubmitting']).toBe('');
    expect(el(fixture, '.root').getAttribute('aria-busy')).toBe('true');
    expect(button(fixture, '.approve').disabled).toBe(true);
    expect(button(fixture, '.deny').disabled).toBe(true);
    await click(fixture, '.deny');
    expect(store.onRespondToToolApproval).toHaveBeenCalledTimes(1);

    store.messages.set([gated({ id: 'req-1', approved: true })]);
    await settle(fixture);
    expect(el(fixture, '.root').dataset['nxaApproval']).toBe('approved');
    expect(el(fixture, '.root').hasAttribute('data-nxa-submitting')).toBe(false);
    expect(el(fixture, '.root').hasAttribute('aria-busy')).toBe(false);
    expect(button(fixture, '.approve').disabled).toBe(true);
    expect(el(fixture, '.receipt').textContent).toBe('allowed,decided,user,-,');
  });

  it('leaves an open request unanswerable once its run was cancelled', async () => {
    const store = createStore([
      gated({ id: 'req-1' }, { type: 'incomplete', reason: 'cancelled' }),
    ]);
    const fixture = await mount(store);
    expect(el(fixture, '.root').hasAttribute('data-nxa-approval')).toBe(false);
    expect(el(fixture, '.receipt').textContent).toBe('');
    expect(button(fixture, '.approve').disabled).toBe(true);
    expect(button(fixture, '.deny').disabled).toBe(true);
  });

  it('has no request state for a tool call without approval', async () => {
    const store = createStore([
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c', toolName: 'x', args: {} }],
      },
    ]);
    const fixture = await mount(store);
    expect(el(fixture, '.root').hasAttribute('data-nxa-approval')).toBe(false);
    expect(el(fixture, '.root').hasAttribute('data-nxa-display')).toBe(false);
    expect(button(fixture, '.approve').disabled).toBe(true);
    await click(fixture, '.approve');
    expect(store.onRespondToToolApproval).not.toHaveBeenCalled();
  });

  it('shows the request without live controls when the thread cannot answer', async () => {
    const store = createStore(
      [gated({ id: 'req-1', options: [{ id: 'o', kind: 'allow-once' }] })],
      {
        answers: false,
      },
    );
    const fixture = await mount(store);
    expect(el(fixture, '.root').dataset['nxaApproval']).toBe('pending');
    for (const selector of ['.approve', '.deny', '[data-test="option-o"]']) {
      expect(button(fixture, selector).disabled).toBe(true);
    }
  });
});

describe('approval options', () => {
  const options = [
    { id: 'deny', kind: 'reject-once' },
    { id: 'custom', kind: '_ask-later', label: 'Ask later' },
    { id: 'always', kind: 'allow-always' },
    { id: 'never', kind: 'reject-always' },
    { id: 'once', kind: 'allow-once' },
  ];

  it('orders the allowing options first, then custom kinds, then the refusing ones', async () => {
    const store = createStore([gated({ id: 'req-1', options })]);
    const fixture = await mount(store);
    expect(el(fixture, '.options').textContent).toBe('always,once,custom,deny,never');
    expect(button(fixture, '[data-test="option-always"]').dataset['nxaKind']).toBe('allow-always');
    expect(button(fixture, '[data-test="option-always"]').dataset['nxaOptionId']).toBe('always');
  });

  it('answers a known kind with its option id, and the runtime derives the decision', async () => {
    const store = createStore([gated({ id: 'req-1', options })]);
    const fixture = await mount(store);

    await click(fixture, '[data-test="option-never"]');
    await flush();

    expect(response(store)).toEqual({ approvalId: 'req-1', approved: false, optionId: 'never' });
  });

  it('answers a custom kind as an approval, since picking it is an answer', async () => {
    const store = createStore([gated({ id: 'req-1', options })]);
    const fixture = await mount(store);

    await click(fixture, '[data-test="option-custom"]');
    await flush();

    expect(response(store)).toEqual({ approvalId: 'req-1', approved: true, optionId: 'custom' });
  });

  it('keeps the plain refusal when every declared option is a custom kind', async () => {
    const store = createStore([gated({ id: 'req-1', options: [{ id: 'a', kind: '_a' }] })]);
    const fixture = await mount(store);

    expect(button(fixture, '.deny').disabled).toBe(false);
    await click(fixture, '.deny');
    await flush();
    expect(response(store)).toEqual({ approvalId: 'req-1', approved: false });
  });

  it('runs the confirmation step of an option that asks for one', async () => {
    const store = createStore([
      gated({
        id: 'req-1',
        options: [
          { id: 'always', kind: 'allow-always', confirm: { title: 'Sure?' } },
          { id: 'once', kind: 'allow-once' },
        ],
      }),
    ]);
    const fixture = await mount(store);
    expect(button(fixture, '.confirm').disabled).toBe(true);

    await click(fixture, '[data-test="option-always"]');
    expect(store.onRespondToToolApproval).not.toHaveBeenCalled();
    expect(el(fixture, '.root').dataset['nxaConfirming']).toBe('');
    expect(el(fixture, '.confirming').textContent).toBe('always');

    await click(fixture, '.confirm-cancel');
    expect(el(fixture, '.root').hasAttribute('data-nxa-confirming')).toBe(false);
    expect(store.onRespondToToolApproval).not.toHaveBeenCalled();

    await click(fixture, '[data-test="option-always"]');
    await click(fixture, '.confirm');
    await flush();
    expect(response(store)).toEqual({ approvalId: 'req-1', approved: true, optionId: 'always' });
    expect(el(fixture, '.root').hasAttribute('data-nxa-confirming')).toBe(false);
  });

  it('runs the confirmation step for a custom kind too', async () => {
    const store = createStore([
      gated({ id: 'req-1', options: [{ id: 'later', kind: '_later', confirm: true }] }),
    ]);
    const fixture = await mount(store);

    await click(fixture, '[data-test="option-later"]');
    expect(store.onRespondToToolApproval).not.toHaveBeenCalled();
    await click(fixture, '.confirm');
    await flush();
    expect(response(store)).toEqual({ approvalId: 'req-1', approved: true, optionId: 'later' });
  });
});

describe('questions and typed answers', () => {
  it('answers a free-form request with the text, not a fabricated decision', async () => {
    const store = createStore([gated({ id: 'req-1', display: 'text', prompt: 'Which color?' })]);
    const fixture = await mount(store);
    expect(el(fixture, '.root').dataset['nxaDisplay']).toBe('text');

    await type(fixture, '.text', 'blue');
    await click(fixture, '.submit-text');
    await flush();

    expect(response(store)).toEqual({ approvalId: 'req-1', approved: true, text: 'blue' });
  });

  it('sends an empty answer to a text question as the answer it is', async () => {
    const store = createStore([gated({ id: 'req-1', display: 'text' })]);
    const fixture = await mount(store);

    await click(fixture, '.submit-text');
    await flush();

    expect(response(store)).toEqual({ approvalId: 'req-1', approved: true, text: '' });
  });

  it.each([
    { display: 'text' as const },
    { display: 'select' as const, options: [{ id: 'a', kind: '_a' }] },
    { display: 'questions' as const, questions: [{ id: 'q', prompt: 'Why?' }] },
  ])('offers no allow or deny to a $display question', async (request) => {
    const store = createStore([gated({ id: 'req-1', ...request })]);
    const fixture = await mount(store);
    expect(button(fixture, '.approve').disabled).toBe(true);
    expect(button(fixture, '.deny').disabled).toBe(true);
    await click(fixture, '.approve');
    await click(fixture, '.deny');
    expect(store.onRespondToToolApproval).not.toHaveBeenCalled();
  });

  it('keeps the typed answer of a decision as its note, not as an answer of its own', async () => {
    const store = createStore([gated({ id: 'req-1', allowFreeform: true })]);
    const fixture = await mount(store);
    expect(el<HTMLTextAreaElement>(fixture, '.text').disabled).toBe(false);
    expect(button(fixture, '.submit-text').disabled).toBe(true);

    await type(fixture, '.text', 'only this once');
    await click(fixture, '.submit-text');
    expect(store.onRespondToToolApproval).not.toHaveBeenCalled();
    await click(fixture, '.approve');
    await flush();
    expect(response(store)).toEqual({
      approvalId: 'req-1',
      approved: true,
      text: 'only this once',
    });
  });

  it('takes a typed answer beside the options of a select question that allows it', async () => {
    const store = createStore([
      gated({
        id: 'req-1',
        display: 'select',
        allowFreeform: true,
        options: [{ id: 'red', kind: '_red' }],
      }),
    ]);
    const fixture = await mount(store);
    await type(fixture, '.text', 'green');
    await click(fixture, '.submit-text');
    await flush();
    expect(response(store)).toEqual({ approvalId: 'req-1', approved: true, text: 'green' });
  });

  it('dismisses a question that accepts it, without the typed draft', async () => {
    const store = createStore([gated({ id: 'req-1', display: 'text', dismissible: true })]);
    const fixture = await mount(store);

    await type(fixture, '.text', 'draft');
    await click(fixture, '.dismiss');
    await flush();

    expect(response(store)).toEqual({ approvalId: 'req-1', approved: false });
  });

  it('offers a dismissal only to a question that declares it', async () => {
    for (const approval of [
      { id: 'decision', dismissible: true },
      { id: 'question', display: 'select' as const, options: [{ id: 'a', kind: '_a' }] },
    ]) {
      const store = createStore([gated(approval)]);
      const fixture = await mount(store);
      expect(button(fixture, '.dismiss').disabled).toBe(true);
      await click(fixture, '.dismiss');
      expect(store.onRespondToToolApproval).not.toHaveBeenCalled();
      fixture.destroy();
    }
  });

  it('answers a select question with an option beside its prompt', async () => {
    const store = createStore([
      gated({
        id: 'req-1',
        display: 'select',
        options: [
          { id: 'red', kind: '_red', label: 'Red' },
          { id: 'blue', kind: '_blue', label: 'Blue' },
        ],
      }),
    ]);
    const fixture = await mount(store);

    await click(fixture, '[data-test="option-blue"]');
    await flush();
    expect(response(store)).toEqual({ approvalId: 'req-1', approved: true, optionId: 'blue' });
  });
});

describe('display "questions"', () => {
  const questionnaire = (): Approval => ({
    id: 'req-q',
    display: 'questions',
    dismissible: true,
    questions: [
      {
        id: 'scope',
        prompt: 'Which files?',
        options: [
          { id: 'all', label: 'All' },
          { id: 'some', label: 'Some' },
        ],
      },
      {
        id: 'tags',
        prompt: 'Which tags?',
        multiple: true,
        options: [
          { id: 'x', label: 'X' },
          { id: 'y', label: 'Y' },
        ],
      },
      { id: '__proto__', prompt: 'Anything else?' },
    ],
  });

  it('renders one row per question and sends every answer once each has one', async () => {
    const store = createStore([gated(questionnaire())]);
    const fixture = await mount(store);
    const rows = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('fieldset'),
    ).map((row) => row.dataset['question']);
    expect(rows).toEqual(['scope', 'tags', '__proto__']);
    expect(button(fixture, '.submit-answers').disabled).toBe(true);

    await click(fixture, '[data-test="scope-all"]');
    await click(fixture, '[data-test="scope-some"]');
    expect(button(fixture, '[data-test="scope-all"]').getAttribute('aria-pressed')).toBe('false');
    expect(button(fixture, '[data-test="scope-some"]').getAttribute('aria-pressed')).toBe('true');
    expect(button(fixture, '[data-test="scope-some"]').dataset['nxaChosen']).toBe('');

    await click(fixture, '[data-test="tags-x"]');
    await click(fixture, '[data-test="tags-y"]');
    expect(button(fixture, '.submit-answers').disabled).toBe(true);

    await type(fixture, 'fieldset[data-question="__proto__"] textarea', 'nope');
    expect(button(fixture, '.submit-answers').disabled).toBe(false);
    // Options without allowFreeform take no typed answer.
    expect(
      el<HTMLTextAreaElement>(fixture, 'fieldset[data-question="scope"] textarea').disabled,
    ).toBe(true);

    await click(fixture, '.submit-answers');
    await flush();

    const sent = response(store) as { answers: Record<string, unknown> };
    expect(sent).toMatchObject({ approvalId: 'req-q', approved: true });
    expect(Object.keys(sent.answers)).toEqual(['scope', 'tags', '__proto__']);
    expect(sent.answers['scope']).toEqual({ optionIds: ['some'] });
    expect(sent.answers['tags']).toEqual({ optionIds: ['x', 'y'] });
    expect(Object.getOwnPropertyDescriptor(sent.answers, '__proto__')?.value).toEqual({
      text: 'nope',
    });
  });

  it('clears an option chosen twice, and keeps the answers of the same request on updates', async () => {
    const store = createStore([gated(questionnaire())]);
    const fixture = await mount(store);

    await click(fixture, '[data-test="tags-x"]');
    await click(fixture, '[data-test="tags-x"]');
    expect(button(fixture, '[data-test="tags-x"]').getAttribute('aria-pressed')).toBe('false');

    await click(fixture, '[data-test="scope-all"]');
    // The same request arrives again, as a new object.
    store.messages.set([gated(questionnaire())]);
    await settle(fixture);
    expect(button(fixture, '[data-test="scope-all"]').getAttribute('aria-pressed')).toBe('true');

    // A different request starts unanswered.
    store.messages.set([gated({ ...questionnaire(), id: 'req-q2' })]);
    await settle(fixture);
    expect(button(fixture, '[data-test="scope-all"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('dismisses a questionnaire that allows it', async () => {
    const store = createStore([gated(questionnaire())]);
    const fixture = await mount(store);
    await click(fixture, '.dismiss');
    await flush();
    expect(response(store)).toEqual({ approvalId: 'req-q', approved: false });
  });

  it('reopens the controls with the error when the host rejects the answers', async () => {
    const store = createStore([gated(questionnaire())]);
    store.onRespondToToolApproval.mockRejectedValueOnce(new Error('host said no'));
    const fixture = await mount(store);

    await click(fixture, '[data-test="scope-all"]');
    await click(fixture, '[data-test="tags-x"]');
    await type(fixture, 'fieldset[data-question="__proto__"] textarea', 'n');
    await click(fixture, '.submit-answers');
    await flush();
    await settle(fixture);

    expect(el(fixture, '.error').textContent).toBe('host said no');
    expect(el(fixture, '.root').dataset['nxaError']).toBe('');
    expect(button(fixture, '.submit-answers').disabled).toBe(false);
    expect(button(fixture, '[data-test="scope-all"]').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('approval errors and request changes', () => {
  it('reports a synchronous refusal and keeps the controls actionable', async () => {
    const store = createStore([gated({ id: 'req-1' })]);
    const fixture = await mount(store);

    // The runtime refuses a typed answer the request does not accept, before the host sees it.
    await click(fixture, '.submit-text');
    expect(store.onRespondToToolApproval).not.toHaveBeenCalled();

    store.onRespondToToolApproval.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    await click(fixture, '.approve');
    await flush();
    await settle(fixture);

    expect(el(fixture, '.error').textContent).toBe('offline');
    expect(button(fixture, '.approve').disabled).toBe(false);

    await click(fixture, '.approve');
    expect(el(fixture, '.error').textContent).toBe('');
    expect(el(fixture, '.root').hasAttribute('data-nxa-error')).toBe(false);
  });

  it('reports a rejection raised after the response was sent', async () => {
    const store = createStore([gated({ id: 'req-1' })]);
    let reject!: (error: Error) => void;
    store.onRespondToToolApproval.mockReturnValueOnce(
      new Promise<void>((_, fail) => (reject = fail)),
    );
    const fixture = await mount(store);

    await click(fixture, '.approve');
    expect(button(fixture, '.approve').disabled).toBe(true);

    reject(new Error('expired on the server'));
    await flush();
    await settle(fixture);
    expect(el(fixture, '.error').textContent).toBe('expired on the server');
    expect(button(fixture, '.approve').disabled).toBe(false);
  });

  it('starts a new request without the previous draft, error, lock or confirmation', async () => {
    const store = createStore([
      gated({
        id: 'req-1',
        allowFreeform: true,
        options: [{ id: 'always', kind: 'allow-always', confirm: true }],
      }),
    ]);
    store.onRespondToToolApproval.mockRejectedValueOnce(new Error('nope'));
    const fixture = await mount(store);

    await type(fixture, '.text', 'note');
    await click(fixture, '.approve');
    await flush();
    await settle(fixture);
    expect(el(fixture, '.error').textContent).toBe('nope');
    await click(fixture, '[data-test="option-always"]');
    expect(el(fixture, '.confirming').textContent).toBe('always');

    store.messages.set([
      gated({
        id: 'req-2',
        allowFreeform: true,
        options: [{ id: 'always', kind: 'allow-always', confirm: true }],
      }),
    ]);
    await settle(fixture);
    expect(el<HTMLTextAreaElement>(fixture, '.text').value).toBe('');
    expect(el(fixture, '.error').textContent).toBe('');
    expect(el(fixture, '.confirming').textContent).toBe('');

    // And a request that follows a sent answer starts unlocked.
    await click(fixture, '.approve');
    expect(button(fixture, '.approve').disabled).toBe(true);
    store.messages.set([gated({ id: 'req-3' })]);
    await settle(fixture);
    expect(button(fixture, '.approve').disabled).toBe(false);
  });

  it("ignores an earlier request's rejection while the next one is pending", async () => {
    const store = createStore([gated({ id: 'req-1' })]);
    let reject!: (error: Error) => void;
    store.onRespondToToolApproval.mockReturnValueOnce(
      new Promise<void>((_, fail) => (reject = fail)),
    );
    const fixture = await mount(store);

    await click(fixture, '.approve');
    store.messages.set([gated({ id: 'req-2' })]);
    await settle(fixture);
    expect(button(fixture, '.approve').disabled).toBe(false);

    reject(new Error('late'));
    await flush();
    await settle(fixture);
    expect(el(fixture, '.error').textContent).toBe('');
    expect(button(fixture, '.approve').disabled).toBe(false);
  });
});

describe('settled approval receipts', () => {
  it.each([
    [{ approved: true }, 'approved', 'allowed,decided,user,-,'],
    [{ approved: false }, 'denied', 'refused,decided,user,-,'],
    [{ resolution: 'cancelled' as const }, 'cancelled', 'closed,decided,user,-,'],
    [{ resolution: 'expired' as const }, 'expired', 'closed,decided,user,-,'],
    [{ approved: true, isAutomatic: true }, 'approved', 'allowed,decided,automatic,-,'],
  ])('records %o', async (settled, outcome, receipt) => {
    const store = createStore([gated({ id: 'req-1', ...settled })]);
    const fixture = await mount(store);
    expect(el(fixture, '.root').dataset['nxaApproval']).toBe(outcome);
    expect(el(fixture, '.receipt').textContent).toBe(receipt);
    expect(button(fixture, '.approve').disabled).toBe(true);
  });

  it('records the option a gate was allowed with', async () => {
    const store = createStore([
      gated({
        id: 'req-1',
        approved: true,
        optionId: 'always',
        options: [{ id: 'always', kind: 'allow-always' }],
      }),
    ]);
    const fixture = await mount(store);
    expect(el(fixture, '.receipt').textContent).toBe('allowed,decided,user,always,');
  });

  it('records a denial with its note and reason, once each', async () => {
    const store = createStore([
      gated({ id: 'req-1', approved: false, text: 'too risky', reason: 'too risky' }),
    ]);
    const fixture = await mount(store);
    expect(el(fixture, '.receipt').textContent).toBe('refused,decided,user,-,too risky');
  });

  it('records the answer to a question, and a custom option, as answers', async () => {
    const store = createStore([
      gated({ id: 'req-1', display: 'text', approved: true, text: 'blue' }),
    ]);
    const fixture = await mount(store);
    expect(el(fixture, '.receipt').textContent).toBe('allowed,answered,user,-,blue');

    store.messages.set([
      gated({
        id: 'req-2',
        approved: true,
        optionId: 'later',
        options: [{ id: 'later', kind: '_l' }],
      }),
    ]);
    await settle(fixture);
    expect(el(fixture, '.receipt').textContent).toBe('allowed,answered,user,later,');
  });
});

describe('questionnaire receipts', () => {
  it('records each answer under its question, own keys only', async () => {
    const store = createStore([
      gated({
        id: 'req-q',
        display: 'questions',
        approved: true,
        questions: [
          { id: 'scope', prompt: 'Which?', options: [{ id: 'all', label: 'All' }] },
          { id: '__proto__', prompt: 'Else?' },
          { id: 'constructor', prompt: 'Unanswered' },
        ],
        answers: Object.fromEntries([
          ['scope', { optionIds: ['all', 'gone'] }],
          ['__proto__', { text: 'nothing' }],
        ]),
      }),
    ]);
    const fixture = await mount(store);
    expect(el(fixture, '.receipt').textContent).toBe('allowed,answered,user,-,');
    expect(el(fixture, '.answers').textContent).toBe('scope=All+gone+;__proto__=nothing');
  });
});

describe('injectToolApproval', () => {
  it('throws outside an approval root', () => {
    @Component({ template: `` })
    class Outside {
      readonly approval = injectToolApproval();
    }
    expect(() => TestBed.createComponent(Outside)).toThrow(/No tool approval here/);
  });

  it('throws when the root is outside a tool call scope', () => {
    @Component({ imports: [NxaToolApprovalRoot], template: `<div nxaToolApprovalRoot></div>` })
    class Outside {}
    expect(() => TestBed.createComponent(Outside).detectChanges()).toThrow(
      /No tool call scope here/,
    );
  });
});
