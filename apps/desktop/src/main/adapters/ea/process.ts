import { killProcesses, waitForExit } from '../_shared/processes';

const EA_PROCS = ['EADesktop.exe', 'EABackgroundService.exe', 'EALocalHostSvc.exe'];

export const killEaProcesses = (): Promise<void> => killProcesses(EA_PROCS);
export const waitForEaExit = (timeoutMs = 5000): Promise<void> =>
  waitForExit('EADesktop.exe', timeoutMs);
