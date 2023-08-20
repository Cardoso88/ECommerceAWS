import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs"
import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import * as ssm from "aws-cdk-lib/aws-ssm"

interface ProductsAppStackProps extends cdk.StackProps {
  eventsDdb: dynamodb.Table
}

export class ProductsAppStack extends cdk.Stack {
  readonly productsFetchHandler: lambdaNodeJs.NodejsFunction
  readonly productsAdminHandler: lambdaNodeJs.NodejsFunction
  readonly productsDdb: dynamodb.Table

  constructor(scope: Construct, id: string, props: ProductsAppStackProps) {
    super(scope, id, props)
    
    this.productsDdb = new dynamodb.Table(this, "ProductsDdb", {
      tableName: "products",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: { 
        name: 'id', 
        type: dynamodb.AttributeType.STRING 
      },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1
    })

    //Products Layer
    const productsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductsLayerVersionArn")
    const productsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductsLayerVersionArn", productsLayerArn)

    //Products Events Layer
    const productsEventLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductEventsLayerVersionArn")
    const productsEventsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductEventsLayerVersionArn", productsEventLayerArn)

    const productEventsHandler = new lambdaNodeJs.NodejsFunction(
      this, 
      "ProductsEventsFunction",
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "ProductsEventsFunction",
        entry: "lambda/products/productEventsFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          EVENTS_DDB : props.eventsDdb.tableName
        },
        layers: [productsEventsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      })
      props.eventsDdb.grantWriteData(productEventsHandler)

    this.productsFetchHandler = new lambdaNodeJs.NodejsFunction(
      this, 
      "ProductsFetchHandler",
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "ProductsFetchHandler",
        entry: "lambda/products/productsFetchFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(5),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          PRODUCTS_DDB : this.productsDdb.tableName
        },
        layers: [productsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      })
    this.productsDdb.grantReadData(this.productsFetchHandler)
    
    this.productsAdminHandler = new lambdaNodeJs.NodejsFunction(
      this, 
      "ProductsAdminFunction",
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "ProductsAdminFunction",
        entry: "lambda/products/productsAdminFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(5),
        bundling: {
          minify: true,
          sourceMap: false
        },
        environment: {
          PRODUCTS_DDB : this.productsDdb.tableName,
          PRODUCT_EVENTS_FUNCTION_NAME: productEventsHandler.functionName
        },
        layers: [productsLayer, productsEventsLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
      })
    this.productsDdb.grantWriteData(this.productsAdminHandler)
    productEventsHandler.grantInvoke(this.productsAdminHandler)
  }
}