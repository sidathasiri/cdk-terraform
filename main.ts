import { Construct } from 'constructs';
import {
  App,
  AssetType,
  S3Backend,
  TerraformAsset,
  TerraformOutput,
  TerraformStack,
} from 'cdktf';

import * as aws from '@cdktf/provider-aws';
import path = require('path');
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { ApiGatewayRestApi } from '@cdktf/provider-aws/lib/api-gateway-rest-api';
import { ApiGatewayResource } from '@cdktf/provider-aws/lib/api-gateway-resource';
import { ApiGatewayMethod } from '@cdktf/provider-aws/lib/api-gateway-method';
import { ApiGatewayIntegration } from '@cdktf/provider-aws/lib/api-gateway-integration';
import { ApiGatewayDeployment } from '@cdktf/provider-aws/lib/api-gateway-deployment';
import { ApiGatewayStage } from '@cdktf/provider-aws/lib/api-gateway-stage';

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

    // Create API Gateway
    const restApi = new ApiGatewayRestApi(this, 'restApi', {
      name: 'my-rest-api',
      description: 'my-rest-api',
    });

    // Create API Gateway resource
    const helloResource = new ApiGatewayResource(this, 'resourceApi', {
      restApiId: restApi.id,
      parentId: restApi.rootResourceId,
      pathPart: 'hello',
    });

    // Create API Gateway method
    const getAPI = new ApiGatewayMethod(this, 'postApi', {
      restApiId: restApi.id,
      resourceId: helloResource.id,
      httpMethod: 'GET',
      authorization: 'NONE',
    });

    new ApiGatewayIntegration(this, 'apiIntegration', {
      restApiId: restApi.id,
      resourceId: helloResource.id,
      httpMethod: getAPI.httpMethod,
      integrationHttpMethod: 'GET',
      type: 'AWS_PROXY',
      uri: lambdaFunction.invokeArn,
    });

    // Grant permissions to invoke lambda function from API Gateway
    new LambdaPermission(this, 'apig-lambda', {
      statementId: 'AllowExecutionFromAPIGateway',
      action: 'lambda:InvokeFunction',
      functionName: lambdaFunction.functionName,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `${restApi.executionArn}/*/*`,
    });

    const apiDeployment = new ApiGatewayDeployment(this, 'deployment', {
      restApiId: restApi.id,
      dependsOn: [lambdaFunction],
    });

    const apiStage = new ApiGatewayStage(this, 'stage', {
      restApiId: restApi.id,
      stageName: 'v1',
      deploymentId: apiDeployment.id,
      dependsOn: [apiDeployment],
    });

    new TerraformOutput(this, 'apiUrl', {
      value: apiStage.invokeUrl,
      description: 'API URL',
    });
  }
}

const app = new App();
new MyStack(app, 'cdk-terraform');
app.synth();
