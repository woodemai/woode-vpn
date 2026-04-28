import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../db/prisma.module';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionConfigService } from './subscription-config.service';
import { SubscriptionNotifierService } from './subscription-notifier.service';
import { SubscriptionService } from './subscription.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { XuiService } from './xui.service';

@Module({
  imports: [HttpModule, PrismaModule],
  providers: [
    XuiService,
    SubscriptionService,
    TelegramNotifierService,
    SubscriptionNotifierService,
    SubscriptionAccessService,
    SubscriptionConfigService,
  ],
  exports: [
    XuiService,
    SubscriptionService,
    TelegramNotifierService,
    SubscriptionNotifierService,
    SubscriptionConfigService,
  ],
})
export class ServicesModule { }
