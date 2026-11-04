import { IsString, MaxLength } from "class-validator";

export class SetProductPhotoDto {
  // data:image/jpeg;base64,… — at most ~400 KB of picture (checked in the service).
  @IsString()
  @MaxLength(600_000)
  dataUrl!: string;
}
