import { ASR_ACTIONS, ASR_PROFILE_ID } from './asr';
import { ACTIONS, EC200A_PROFILE_ID } from './ec200a';
import type { ActionDefinition } from './types';

/** The actions a modem profile offers. Empty for every profile without its own definitions. */
export function actionsFor(profileId: string | undefined): ActionDefinition[] {
  if (profileId === EC200A_PROFILE_ID) return ACTIONS;
  if (profileId === ASR_PROFILE_ID) return ASR_ACTIONS;
  return [];
}
