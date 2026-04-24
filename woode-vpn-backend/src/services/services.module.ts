import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { XuiService } from './xui.service';

@Module({
  imports: [HttpModule],
  providers: [XuiService, SubscriptionService, TelegramNotifierService],
  exports: [XuiService, SubscriptionService, TelegramNotifierService],
})
export class ServicesModule { }
