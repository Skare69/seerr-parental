import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParentalRatingColumns1788255769998 implements MigrationInterface {
  name = 'AddParentalRatingColumns1788255769998';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "maxParentalRating" integer`
    );
    await queryRunner.query(`ALTER TABLE "user" ADD "dateOfBirth" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "dateOfBirth"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "maxParentalRating"`
    );
  }
}
