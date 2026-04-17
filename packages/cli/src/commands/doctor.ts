import { loadConfig, type CliConfig } from '../config.js';
import { printJson, printLine } from '../output.js';

interface DoctorCheck {
  ok: boolean;
  message: string;
}

interface DoctorReport {
  config: DoctorCheck;
  session: DoctorCheck;
  domains: DoctorCheck;
}

export async function runDoctor(deps: {
  loadConfig?: () => Promise<CliConfig>;
  fetchImpl?: typeof fetch;
} = {}): Promise<DoctorReport> {
  const load = deps.loadConfig ?? loadConfig;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const report: DoctorReport = {
    config: { ok: false, message: '' },
    session: { ok: false, message: '' },
    domains: { ok: false, message: '' },
  };

  let config: CliConfig;
  try {
    config = await load();
    report.config = {
      ok: true,
      message: `base_url=${config.baseUrl}, user=${config.username}, role=${config.role}`,
    };
  } catch (error) {
    report.config = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
    return report;
  }

  try {
    const response = await fetchImpl(new URL('/api/cli/session', config.baseUrl).toString(), {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    });
    if (!response.ok) {
      report.session = { ok: false, message: `HTTP ${response.status}` };
    } else {
      const payload = await response.json() as { authenticated?: boolean; username?: string; role?: string };
      report.session = {
        ok: true,
        message: `authenticated=${Boolean(payload.authenticated)}, user=${payload.username ?? ''}, role=${payload.role ?? ''}`,
      };
    }
  } catch (error) {
    report.session = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const response = await fetchImpl(new URL('/api/domains', config.baseUrl).toString(), {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    });
    if (!response.ok) {
      report.domains = { ok: false, message: `HTTP ${response.status}` };
    } else {
      const payload = await response.json() as string[];
      report.domains = {
        ok: true,
        message: payload.join(', '),
      };
    }
  } catch (error) {
    report.domains = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return report;
}

export async function doctorAction(options: { json?: boolean } = {}): Promise<void> {
  const report = await runDoctor();
  if (options.json) {
    printJson(report);
    return;
  }

  printLine(`config\t${report.config.ok ? 'ok' : 'fail'}\t${report.config.message}`);
  printLine(`session\t${report.session.ok ? 'ok' : 'fail'}\t${report.session.message}`);
  printLine(`domains\t${report.domains.ok ? 'ok' : 'fail'}\t${report.domains.message}`);
}
