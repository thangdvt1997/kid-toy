import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderMediaDto {
  @ApiProperty({ type: [String], description: 'Every media id for the product, in the new order' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedIds!: string[];
}
