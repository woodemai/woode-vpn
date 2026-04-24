import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import appConfig from './config/app.config';
import xuiConfig from './config/xui.config';
import { PrismaModule } from './db/prisma.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { UsersModule } from './modules/users/users.module';
import { VpnModule } from './modules/vpn/vpn.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, xuiConfig],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    VpnModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
