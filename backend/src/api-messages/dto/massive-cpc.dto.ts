import { IsString, IsNotEmpty, IsArray, ValidateNested, IsBoolean, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class MessageDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsNumber()
  @IsOptional()
  idMessage?: number;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  contract?: string;

  @IsBoolean()
  @IsNotEmpty()
  closeTicket: boolean;

  @IsString()
  @IsNotEmpty()
  specialistCode: string;

  @IsString()
  @IsNotEmpty()
  mainTemplate: string;

  @IsString()
  @IsOptional()
  retryTemplate?: string;

  @IsString()
  @IsOptional()
  lastTemplate?: string;
}

export class MassiveCpcDto {
  @IsString()
  @IsNotEmpty()
  campaign: string;

  @IsString()
  @IsOptional()
  idAccount?: string;

  @IsString()
  @IsNotEmpty()
  tag: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  messages: MessageDto[];
}

