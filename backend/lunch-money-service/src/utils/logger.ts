import * as winston from 'winston';
import config from '../config';

export default winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'DD.MM.YYYY HH:mm:ss.SSS',
    }),
    winston.format.printf((info) => {
      const level = `[${info.level.toUpperCase()}]`;
      return `[${info.timestamp}] ${level.padEnd(9)} ${info.message}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});
