import { Construct } from 'constructs';
import {
  App,
  AssetType,
  S3Backend,
  TerraformAsset,
  TerraformStack,
} from 'cdktf';

import * as aws from '@cdktf/provider-aws';
import path = require('path');

class MyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new aws.provider.AwsProvider(this, 'aws', {
      region: 'us-east-1',
      allowedAccountIds: ['826406658508'],
    });

    // S3 Backend - https://www.terraform.io/docs/backends/types/s3.html
    new S3Backend(this, {
      bucket: 'cdk-terraform-backend',
      key: 'backend',
      region: 'us-east-1',
    });

    // Lambda execution role
    const role = new aws.iamRole.IamRole(this, 'lambda-exec-role', {
      name: 'cdk-tf-role',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Effect: 'Allow',
            Sid: '',
          },
        ],
      }),
    });

    // Attach policy to role
    new aws.iamRolePolicyAttachment.IamRolePolicyAttachment(
      this,
      'lambda-managed-policy',
      {
        policyArn:
          'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        role: role.name,
      }
    );

    const asset = new TerraformAsset(this, 'lambda-asset', {
      path: path.resolve(__dirname, './src/'),
      type: AssetType.ARCHIVE,
    });

    const bucket = new aws.s3Bucket.S3Bucket(this, 'bucket', {
      bucketPrefix: 'cdktf-bucket',
    });

    const lambdaArchive = new aws.s3Object.S3Object(this, 'lambda-archive', {
      bucket: bucket.bucket,
      key: `v1/${asset.fileName}`,
      source: asset.path, // returns a posix path
    });

    const lambdaFunction = new aws.lambdaFunction.LambdaFunction(
      this,
      'cdktf-lambda-function',
      {
        functionName: 'cdktf-lambda-function',
        handler: 'index.handler',
        runtime: 'nodejs20.x',
        role: role.arn,
        s3Bucket: bucket.bucket,
        s3Key: lambdaArchive.key,
      }
    );
  }
}

const app = new App();
new MyStack(app, 'cdk-terraform');
app.synth();
