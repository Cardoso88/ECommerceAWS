import * as lambda from "aws-cdk-lib/aws-lambda"
import * as lambdaNodeJs from "aws-cdk-lib/aws-lambda-nodejs"
import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import * as dynadb from "aws-cdk-lib/aws-dynamodb"
import * as ssm from "aws-cdk-lib/aws-ssm"

export class ProductsAppStack extends cdk.Stack {
  readonly productsFetchHandler: lambdaNodeJs.NodejsFunction
  readonly productsAdminHandler: lambdaNodeJs.NodejsFunction
  readonly productsDdb: dynadb.Table

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)
    
    this.productsDdb = new dynadb.Table(this, "ProductsDdb", {
      tableName: "products",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: { 
        name: 'id', 
        type: dynadb.AttributeType.STRING 
      },
      billingMode: dynadb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1
    })

    //Products Layer
    const productsLayerArn = ssm.StringParameter.valueForStringParameter(this, "ProductsLayerVersionArn")
    const productsLayer = lambda.LayerVersion.fromLayerVersionArn(this, "ProductsLayerVersionArn", productsLayerArn)

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
        layers: [productsLayer]
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
          PRODUCTS_DDB : this.productsDdb.tableName
        },
        layers: [productsLayer]
      })
    this.productsDdb.grantWriteData(this.productsAdminHandler)
  }
}