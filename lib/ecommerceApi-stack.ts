import * as cdk from "aws-cdk-lib"
import * as lambdaNodeJS from "aws-cdk-lib/aws-lambda-nodejs"
import * as apigateway from "aws-cdk-lib/aws-apigateway"
import * as cwlogs from "aws-cdk-lib/aws-logs"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as iam from "aws-cdk-lib/aws-iam"
import { Construct } from "constructs"

interface ECommerceApiStackProps extends cdk.StackProps {
  productsFetchHandler: lambdaNodeJS.NodejsFunction;
  productsAdminHandler: lambdaNodeJS.NodejsFunction;
  ordersHandler: lambdaNodeJS.NodejsFunction;
  ordersEventsFetchHandler: lambdaNodeJS.NodejsFunction;
}

export class ECommerceApiStack extends cdk.Stack {
  private productsAuthorizer: apigateway.CognitoUserPoolsAuthorizer
  private productsAdminAuthorizer: apigateway.CognitoUserPoolsAuthorizer
  private customerPool: cognito.UserPool
  private adminPool: cognito.UserPool
  
  constructor(scope: Construct, id: string, props: ECommerceApiStackProps) {
    super(scope, id, props)

    const logGroup = new cwlogs.LogGroup(this, "ECommerceApiLogs")
    const api = new apigateway.RestApi(this, "ECommerceApi", {
      restApiName: 'ECommerceApi',
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          caller: true,
          user: true
        })
      }
    })

    this.createCognitoAuth()

    const adminUserPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["cognito-idp:AdminGetUser"],
      resources: [this.adminPool.userPoolArn]
    })
    const adminUserPolicy = new iam.Policy(this, 'AdminGetUserPolicy', {
      statements: [adminUserPolicyStatement]
    })
    adminUserPolicy.attachToRole(<iam.Role> props.productsAdminHandler.role)

    this.createProductsService(props, api)
    this.createOrdersService(props, api)
  }

  private createCognitoAuth() {
    const postConfirmationHandler = new lambdaNodeJS.NodejsFunction(this, "PostConfirmationFunction", {
      runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "PostConfirmationFunction",
        entry: "lambda/auth/postConfirmationFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })

    const preAuthencticationHandler = new lambdaNodeJS.NodejsFunction(this, "PreAuthenticationFunction", {
      runtime: lambda.Runtime.NODEJS_16_X,
        functionName: "PreAuthenticationFunction",
        entry: "lambda/auth/preAuthenticationFunction.ts",
        handler: "handler",
        memorySize: 128,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false
        },
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_119_0
    })

    //Cognito customer UserPool
    this.customerPool = new cognito.UserPool(this, "CustomerPool", {
      lambdaTriggers: {
        preAuthentication: preAuthencticationHandler,
        postConfirmation: postConfirmationHandler
      },
      userPoolName: "CustomerPool",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
        phone: false
      },
      userVerification: {
        emailSubject: "Verify your email for the ECommerce service!",
        emailBody: "Thanks for signing up to ECommerce service! Your verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE
      },
      signInAliases: {
        username: false,
        email: true
      },
      standardAttributes: {
        fullname: {
          required: true,
          mutable: false
        }
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3)
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY
    })
    
    //Cognito admin UserPool
    this.adminPool = new cognito.UserPool(this, "AdminPool", {
      userPoolName: "AdminPool",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: false,
      userInvitation:{
        emailSubject: "Welcome to ECommerce administrator service",
        emailBody: 'Your username is {username} and temporary password is {####}'
      },
      signInAliases: {
        username: false,
        email: true
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: false
        }
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(3)
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY
    })

    this.adminPool.addDomain("AdminDomain", {
      cognitoDomain: {
        domainPrefix: "pcs-admin-service"
      }
    })

    this.customerPool.addDomain("CustomerDomain", {
      cognitoDomain: {
        domainPrefix: "pcs-customer-service"
      }
    })

    const customerWebScope = new cognito.ResourceServerScope({
      scopeName: "web",
      scopeDescription: "Customer Web operation"
    })
    const customerMobileScope = new cognito.ResourceServerScope({
      scopeName: "mobile",
      scopeDescription: "Customer Mobile operation"
    })
    const adminWebScope = new cognito.ResourceServerScope({
      scopeName: "web",
      scopeDescription: "Admin Web operation"
    })

    const customerResourceServer = this.customerPool.addResourceServer("CustomerResourceServer", {
      identifier: "customer",
      userPoolResourceServerName: "CustomerResourceServer",
      scopes: [customerMobileScope, customerWebScope]
    })
    const adminResourceServer = this.adminPool.addResourceServer("AdminResourceServer", {
      identifier: "admin",
      userPoolResourceServerName: "AdminResourceServer",
      scopes: [adminWebScope]
    })

    this.customerPool.addClient("customer-web-client", {
      userPoolClientName: "customerWebClient",
      authFlows: {
        userPassword: true
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [cognito.OAuthScope.resourceServer(customerResourceServer, customerWebScope)]
      }
    })

    this.customerPool.addClient("customer-mobile-client", {
      userPoolClientName: "customerMobileClient",
      authFlows: {
        userPassword: true
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [cognito.OAuthScope.resourceServer(customerResourceServer, customerMobileScope)]
      }
    })

    this.adminPool.addClient("admin-web-client", {
      userPoolClientName: "adminWebClient",
      authFlows: {
        userPassword: true
      },
      accessTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(7),
      oAuth: {
        scopes: [cognito.OAuthScope.resourceServer(adminResourceServer, adminWebScope)]
      }
    })

    this.productsAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "ProductsAuthorizer", {
      authorizerName: "ProductsAuthorizer",
      cognitoUserPools: [this.customerPool, this.adminPool]
    })

    this.productsAdminAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "ProductsAdminAuthorizer", {
      authorizerName: "ProductsAdminAuthorizer",
      cognitoUserPools: [this.adminPool]
    })    

  }

  private createOrdersService (props : ECommerceApiStackProps, api: apigateway.RestApi) {
    const ordersIntegration = new apigateway.LambdaIntegration(props.ordersHandler)

    //resource - /orders
    const ordersResource = api.root.addResource('orders')

    //GET /orders
    //GET /orders?email=aaa@gmail.com
    //GET /orders?email=aaa@gmail.com&orderId=123
    ordersResource.addMethod("GET", ordersIntegration)

    const orderDeletionValidator = new apigateway.RequestValidator(this, "OrderDeletionValidator", {
      restApi: api,
      requestValidatorName: "OrderDeletionValidator",
      validateRequestParameters: true
    })
    
    //DELETE /orders?email=aaa@gmail.com&orderId=123
    ordersResource.addMethod("DELETE", ordersIntegration, {
      requestParameters: {
        'method.request.querystring.email': true,
        'method.request.querystring.orderId': true
      },
      requestValidator: orderDeletionValidator
    })

    //POST /orders
    const orderRequestValidator = new apigateway.RequestValidator(this, "OrderRequestValidator", {
      restApi: api,
      requestValidatorName: "Order request validator",
      validateRequestBody: true
    })
    const orderModel = new apigateway.Model(this, "OrderModel", {
      modelName: "OrderModel",
      restApi: api,
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          email: { type: apigateway.JsonSchemaType.STRING },
          productIds: {
            type: apigateway.JsonSchemaType.ARRAY,
            minItems: 1,
            items: { type: apigateway.JsonSchemaType.STRING }  
          },
          payment: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ["CASH", "DEBIT_CARD", "CREDIT_CARD"]
          }
        },
        required: ["emails", "productIds", "payment"]
      }
    })
    ordersResource.addMethod("POST", ordersIntegration, {
      requestValidator: orderRequestValidator,
      requestModels: { "application/json": orderModel }
    })

    // /orders/events
    const orderEventsResource = ordersResource.addResource("events")

    const orderEventsFethValidator = new apigateway.RequestValidator(this, "OrderEventsFethValidator", {
      restApi: api,
      requestValidatorName: "OrderEventsFethValidator",
      validateRequestParameters: true
    })

    const orderEventsFunctionIntegration = new apigateway.LambdaIntegration(props.ordersEventsFetchHandler)
    //GET /orders/events?email=teste@teste.com.br
    //GET /orders/events?email=teste@teste.com.br&eventType=ORDER_CREATED
    orderEventsResource.addMethod('GET', orderEventsFunctionIntegration, {
      requestParameters: {
        'method.request.querystring.email': true,
        'method.request.querystring.eventType': false
      },
      requestValidator: orderEventsFethValidator
    })
  }


  private createProductsService(props: ECommerceApiStackProps, api: apigateway.RestApi) {
    const productsFetchIntegration = new apigateway.LambdaIntegration(props.productsFetchHandler)

    const productsFetchWebMobileIntegrationOption = {
      authorizer: this.productsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ['customer/web', 'customer/mobile', 'admin/web']
    }

    const productsFetchWebIntegrationOption = {
      authorizer: this.productsAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ['customer/web', 'admin/web']
    }

    // "/products"
    const productsResource = api.root.addResource("products")
    productsResource.addMethod("GET", productsFetchIntegration, productsFetchWebMobileIntegrationOption)

    // GET/products/{id}
    const productIdResource = productsResource.addResource("{id}")
    productIdResource.addMethod("GET", productsFetchIntegration, productsFetchWebIntegrationOption)

    const productsAdminIntegration = new apigateway.LambdaIntegration(props.productsAdminHandler)

const productRequestValidator = new apigateway.RequestValidator(this, "ProductRequestValidator", {
         restApi: api,
         requestValidatorName: "Product request validator",
         validateRequestBody: true
      })
      const productModel = new apigateway.Model(this, "ProductModel", {
         modelName: "ProductModel",
         restApi: api,
         contentType: "application/json",
         schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
               productName: {
                  type: apigateway.JsonSchemaType.STRING
               },
               code: {
                  type: apigateway.JsonSchemaType.STRING
               },
               model: {
                  type: apigateway.JsonSchemaType.STRING
               },
               productUrl: {
                  type: apigateway.JsonSchemaType.STRING
               },
               price: {
                  type: apigateway.JsonSchemaType.NUMBER
               }
            },
            required: [
               "productName",
               "code"
            ]
         }
      })
    // POST /products
    productsResource.addMethod("POST", productsAdminIntegration, {
         requestValidator: productRequestValidator,
         requestModels: {
            "application/json": productModel
         },
         authorizer: this.productsAdminAuthorizer,
         authorizationType: apigateway.AuthorizationType.COGNITO,
         authorizationScopes: ['admin/web']
      })

    // PUT /products/{id}
    productIdResource.addMethod("PUT", productsAdminIntegration, {
         requestValidator: productRequestValidator,
         requestModels: {
            "application/json": productModel
         },
         authorizer: this.productsAdminAuthorizer,
         authorizationType: apigateway.AuthorizationType.COGNITO,
         authorizationScopes: ['admin/web']
      })

    // DELETE /products/{id}
    productIdResource.addMethod("DELETE", productsAdminIntegration, {
      authorizer: this.productsAdminAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ['admin/web']
    })
  }
}