import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../db/prisma.module';
import { SubscriptionNotifierService } from './subscription-notifier.service';
import { SubscriptionService } from './subscription.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { XuiService } from './xui.service';

@Module({
  imports: [HttpModule, PrismaModule],
  providers: [XuiService, SubscriptionService, TelegramNotifierService, SubscriptionNotifierService],
  exports: [XuiService, SubscriptionService, TelegramNotifierService, SubscriptionNotifierService],
})
export class ServicesModule { }
