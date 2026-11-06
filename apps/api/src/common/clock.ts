import { Global, Injectable, Module } from '@nestjs/common';

/** The current time. Tests replace it to run time-based rules with a fixed clock. */
@Injectable()
export class Clock {
  now() {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
