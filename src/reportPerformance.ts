import bluebird from 'bluebird';
import { collectReports } from './helpers/collectReports';
import { getConfig } from './config';
import { format as formatDate } from 'date-fns';
import { SecurityHeadersReporter } from './reporters/SecurityHeadersReporter';
import { WebPageTestReporter } from './reporters/WebPageTestReporter';
import { MobileFriendlinessReporter } from './reporters/MobileFriendlinessReporter';
import { AwsLambdaHealthReporter } from './reporters/AwsLambdaHealthReporter';
import { GenericReporterClass, PageReporterClass } from './typings/reporter';
import { SplunkLogger } from './helpers/SplunkLogger';

// tslint:disable no-console max-func-body-length
export const reportPerformance = async () => {
  const config = await getConfig();

  const urls = ['https://hollowverse.com', 'https://hollowverse.com/Tom_Hanks'];

  const pageReporters: PageReporterClass[] = [
    SecurityHeadersReporter,
    MobileFriendlinessReporter,
    WebPageTestReporter,
  ];

  const genericReporters: GenericReporterClass[] = [AwsLambdaHealthReporter];

  const pageReportsPromise = bluebird.map(urls, async url => ({
    url,
    reports: await collectReports({
      reporters: pageReporters.map(ReporterClass => ({
        name: ReporterClass.name,
        instance: new ReporterClass(url, config),
      })),
    }),
  }));

  const genericReportersPromise = collectReports({
    reporters: genericReporters.map(ReporterClass => ({
      name: ReporterClass.name,
      instance: new ReporterClass(config),
    })),
  });

  const genericReports = await genericReportersPromise;
  const pageReports = await pageReportsPromise;
  const dateStr = formatDate(new Date(), 'YYYY-MM-DD');
  type PerfEvent = {
    testName: string;
    scoreName: string;
    scoreValue: any;
    date: string;
    pageUrl: string;
    reportUrl?: string;
  };

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
            date: dateStr,
          });
        });
      }
    });
  });

  // @TODO: generic reports?

  if (process.env.STAGE === 'local') {
    console.info(events);

    return;
  }

  if (config.shouldPush) {
    const { token } = config.splunk;
    if (!token) {
      throw new TypeError('No token was provided for Splunk logger');
    }

    const logger = new SplunkLogger<PerfEvent>({
      token,
      endpoint:
        'https://input-prd-p-kwnk36xd58jf.cloud.splunk.com:8088/services/collector/event',
    });

    events.forEach(event => {
      logger.addEventToQueue(event);
    });

    await logger.flushEvents();
  }
};
