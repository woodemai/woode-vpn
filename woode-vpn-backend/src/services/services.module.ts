import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { XuiService } from './xui.service';

@Module({
  imports: [HttpModule],
  providers: [XuiService, SubscriptionService],
  exports: [XuiService, SubscriptionService],
})
export class ServicesModule {}
