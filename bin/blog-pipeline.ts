#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { QueueStack } from '../lib/queue-stack';
import { SecretValue, Stack, StackProps, Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BuildSpec, EventAction, FilterGroup, GitHubSourceCredentials, Project, Source } from 'aws-cdk-lib/aws-codebuild';
import { CodeBuildStep, CodePipeline, CodePipelineSource } from 'aws-cdk-lib/pipelines';

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new cdk.App();

class BlogPipelineStage extends Stage {
  constructor(scope: Construct, id: string, props: StageProps) {
    super(scope, id, props);
    new QueueStack(this, 'QueueStack', {});
  }
}

class BlogPipeline extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    const owner = 'meadf';
    const repo = 'blog-pipeline';
    const branch = 'main';
    const secretArn = `arn:aws:secretsmanager:${env.region}:${env.account}:secret:BlogPipelineGitHubToken-gwKanq`;
    const pipelineSpec = BuildSpec.fromObject({
      version: 0.2,
      phases: {
        install: {
          commands: ['n latest', 'node -v', 'npm ci'],
        },
        build: {
          commands: ['npx cdk synth']
        }
      }
    });
    const synthAction = new CodeBuildStep(`Synth`, {
      input: CodePipelineSource.gitHub(`${owner}/${repo}`, branch, {
        authentication: SecretValue.secretsManager(secretArn, {
          jsonField: 'access-token',
        }),
      }),
      partialBuildSpec: pipelineSpec,
      commands: [],
    });
    const pipeline = new CodePipeline(this, `Pipeline`, {
      synth: synthAction,
      dockerEnabledForSynth: true,
      // crossAccountKeys: true, // need this if you're actually deploying to multiple accounts
    });

    const stage = new BlogPipelineStage(app, 'BlogPipelineStage', {});
    pipeline.addStage(stage);

    new GitHubSourceCredentials(this, 'GitHubCreds', {
      accessToken: SecretValue.secretsManager('arn:aws:secretsmanager:us-east-1:359317520455:secret:BlogPipelineGitHubToken-gwKanq', {
        jsonField: 'access-token',
      }),
    });

    const prSpec = BuildSpec.fromObject({
      version: 0.2,
      phases: {
        install: {
          commands: ['n latest', 'node -v', 'npm ci'],
        },
        build: {
          commands: ['npm run test']
        }
      }
    });

    const source = Source.gitHub({
      owner: owner,
      repo: repo,
      webhook: true,
      webhookFilters: [
        FilterGroup.inEventOf(
          EventAction.PULL_REQUEST_CREATED,
          EventAction.PULL_REQUEST_UPDATED,
          EventAction.PULL_REQUEST_REOPENED,
        ).andBranchIsNot('main'),
      ],
      reportBuildStatus: true,
    });

    new Project(this, 'PullRequestProject', {
      source,
      buildSpec: prSpec,
      concurrentBuildLimit: 1,
    });
  }
}

new BlogPipeline(app, `BlogPipeline`, {});