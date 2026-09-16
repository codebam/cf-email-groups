import { useState } from 'preact/hooks';
import type { Campaign, GroupAdmin, GroupDetail, SessionUser, Subscriber } from '../lib/types';
import { api, copyText } from './api';
import CampaignsTab from './CampaignsTab';
import SettingsTab from './SettingsTab';
import SubscribersTab from './SubscribersTab';
import { useToasts } from './ui';

interface Props {
  user: SessionUser;
  group: GroupDetail;
  initialSubscribers: Subscriber[];
  initialTotal: number;
  initialPageSize: number;
  initialCampaigns: Campaign[];
  initialAdmins: GroupAdmin[];
  publicUrl: string;
  /** Dedicated single-list deployment: hide multi-list navigation. */
  singleList?: boolean;
}

type Tab = 'subscribers' | 'campaigns' | 'settings';

export default function GroupApp(props: Props) {
  const [tab, setTab] = useState<Tab>('subscribers');
  const [group, setGroup] = useState(props.group);
  const { push, host } = useToasts();

  const refreshGroup = async () => {
    try {
      const result = await api<{ group: GroupDetail }>(`/api/groups/${group.id}`);
      setGroup(result.group);
    } catch (error) {
      console.error(error);
    }
  };

  const copyLink = async () => {
    const ok = await copyText(props.publicUrl);
    push(ok ? 'success' : 'error', ok ? 'Sign-up link copied' : 'Could not copy the link');
  };

  return (
    <div class="page" style="padding-top:1.75rem">
      <div class="page-header">
        <div class="grow">
          {!props.singleList ? (
            <div class="row-tight">
              <a class="muted small" href="/app">
                ← All lists
              </a>
            </div>
          ) : null}
          <h1>{group.name}</h1>
          <div class="row-tight">
            <span class={`badge ${group.role === 'owner' ? 'badge-owner' : 'badge-neutral'}`}>
              {group.role === 'owner' ? 'Owner' : 'Admin'}
            </span>
            <span class="muted small">/join/{group.slug}</span>
          </div>
        </div>
        <div class="row">
          <button type="button" class="btn btn-secondary btn-sm" onClick={() => void copyLink()}>
            Copy sign-up link
          </button>
          <a class="btn btn-secondary btn-sm" href={props.publicUrl} target="_blank" rel="noreferrer">
            View public page
          </a>
          <button type="button" class="btn btn-sm" onClick={() => setTab('campaigns')}>
            New campaign
          </button>
        </div>
      </div>

      <div class="tabs" role="tablist">
        <button type="button" role="tab" class="tab" aria-selected={tab === 'subscribers'} onClick={() => setTab('subscribers')}>
          Subscribers <span class="badge badge-neutral">{group.counts.active + group.counts.pending}</span>
        </button>
        <button type="button" role="tab" class="tab" aria-selected={tab === 'campaigns'} onClick={() => setTab('campaigns')}>
          Campaigns {props.initialCampaigns.length ? <span class="badge badge-neutral">{props.initialCampaigns.length}</span> : null}
        </button>
        <button type="button" role="tab" class="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>
          Settings
        </button>
      </div>

      {tab === 'subscribers' ? (
        <SubscribersTab
          group={group}
          initial={props.initialSubscribers}
          initialTotal={props.initialTotal}
          initialPageSize={props.initialPageSize}
          push={push}
          onRefreshGroup={refreshGroup}
        />
      ) : null}
      {tab === 'campaigns' ? <CampaignsTab user={props.user} group={group} initial={props.initialCampaigns} push={push} /> : null}
      {tab === 'settings' ? (
        <SettingsTab
          user={props.user}
          group={group}
          initialAdmins={props.initialAdmins}
          publicUrl={props.publicUrl}
          push={push}
          onGroupChange={setGroup}
          allowDelete={!props.singleList}
        />
      ) : null}
      {host}
    </div>
  );
}
