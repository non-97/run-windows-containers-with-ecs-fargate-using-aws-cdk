import {
  Stack,
  StackProps,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_ecs_patterns as ecs_patterns,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export class EcsFargateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, "Vpc", {
      cidr: "10.0.0.0/24",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 1,
      maxAzs: 2,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 27 },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          cidrMask: 27,
        },
      ],
    });

    // ECS Cluster
    const ecsCluster = new ecs.Cluster(this, "EcsCluster", {
      vpc,
      containerInsights: true,
    });

    // ECS Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TaskDefinition",
      {
        runtimePlatform: {
          operatingSystemFamily:
            ecs.OperatingSystemFamily.WINDOWS_SERVER_2019_CORE,
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
        },
        cpu: 1024,
        memoryLimitMiB: 2048,
      }
    );

    taskDefinition.addContainer("windowsservercore", {
      logging: ecs.LogDriver.awsLogs({ streamPrefix: "win-iis-on-fargate" }),
      portMappings: [{ containerPort: 80 }],
      image: ecs.ContainerImage.fromRegistry(
        "mcr.microsoft.com/windows/servercore/iis:windowsservercore-ltsc2019"
      ),
    });

    // ALB
    const loadBalancedFargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "LoadBalancedFargateService",
        {
          assignPublicIp: false,
          cluster: ecsCluster,
          taskSubnets: vpc.selectSubnets({
            subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          }),
          memoryLimitMiB: 1024,
          cpu: 512,
          desiredCount: 2,
          taskDefinition: taskDefinition,
          publicLoadBalancer: true,
        }
      );

    loadBalancedFargateService.service.connections.allowFrom(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(80)
    );

    // Auto Scaling Settings
    const scalableTarget =
      loadBalancedFargateService.service.autoScaleTaskCount({
        minCapacity: 2,
        maxCapacity: 10,
      });

    scalableTarget.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 50,
    });

    scalableTarget.scaleOnMemoryUtilization("MemoryScaling", {
      targetUtilizationPercent: 50,
    });
  }
}
