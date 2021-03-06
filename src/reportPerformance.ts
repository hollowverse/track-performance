import bluebird from 'bluebird';
import { collectReports } from './helpers/collectReports';
import { getConfig } from './config';
import { format as formatDate } from 'date-fns';
import { SecurityHeadersReporter } from './reporters/SecurityHeadersReporter';
import { WebPageTestReporter } from './reporters/WebPageTestReporter';
import { MobileFriendlinessReporter } from './reporters/MobileFriendlinessReporter';
import { ReporterClass } from './typings/reporter';
import { SplunkLogger } from './helpers/splunkLogger';
import { ScreenshotDiffReporter } from './reporters/ScreenshotDiffReporter';

type PerfEvent = {
  testName: string;
  scoreName: string;
  scoreValue: any;
  date: string;
  pageUrl: string;
  reportUrl?: string;
};

// tslint:disable no-console max-func-body-length
export const reportPerformance = async () => {
  const config = await getConfig();

  const urls = ['https://hollowverse.com', 'https://hollowverse.com/Tom_Hanks'];

  const pageReporters: ReporterClass[] = [
    ScreenshotDiffReporter,
    SecurityHeadersReporter,
    MobileFriendlinessReporter,
    WebPageTestReporter,
  ];

  const pageReports = await bluebird.map(urls, async url => ({
    url,
    reports: await collectReports({
      reporters: pageReporters.map(Class => ({
        name: Class.name,
        instance: new Class(url, config),
      })),
    }),
  }));

  const date = formatDate(new Date(), 'YYYY-MM-DD');

  const events: PerfEvent[] = [];

  pageReports.forEach(({ url: pageUrl, reports }) => {
    reports.forEach(report => {
      if (!('error' in report)) {
        report.records.forEach(record => {
          events.push({
            testName: report.testName,
            pageUrl,
            reportUrl: report.url,
            scoreName: record.id,
            scoreValue: record.value,
            date,
          });
        });
      }
    });
  });

  if (process.env.STAGE !== 'production') {
    console.info(events);

    return;
  }

  const { token } = config.splunk;
  if (!token) {
    throw new TypeError('No token was provided for Splunk logger');
  }

  const logger = new SplunkLogger<PerfEvent>({
    host: 'PerfReports',
    token,
    endpoint:
      'https://input-prd-p-kwnk36xd58jf.cloud.splunk.com:8088/services/collector/event',
  });

  await logger.addEventsToQueue(events);

  await logger.flushEvents();
};
