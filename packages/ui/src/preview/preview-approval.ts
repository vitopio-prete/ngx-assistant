import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectToolCall } from '@ngx-assistant/angular';
import { NxaApprovalCard } from '../lib';

/** The UI of the preview's `publish_release` tool: an approval card. */
@Component({
  selector: 'nxa-preview-publish',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaApprovalCard],
  template: `
    <nxa-approval-card
      title="Publish the release"
      subtitle="Needs your approval"
      description="This publishes the package to the registry, where it cannot be removed."
      [command]="'npm publish --tag ' + (call.args().tag ?? '')"
      [details]="[{ label: 'version', value: call.args().version ?? '' }]"
    />
  `,
})
export class PreviewPublishUi {
  protected readonly call = injectToolCall<{ version: string; tag: string }>();
}
