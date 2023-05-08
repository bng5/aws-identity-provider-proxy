import { CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export enum Provider {
  Github = 'github',
}

interface ProxyProvider extends Omit<cognito.UserPoolIdentityProviderOidcProps, 'userPool' | 'issuerUrl'> {
  provider: Provider;
}

export interface IdentityProviderProxyProps extends apigateway.RestApiProps {
  readonly userPool: cognito.UserPool;
  readonly providers: ProxyProvider[],
}

export class IdentityProviderProxy extends apigateway.RestApi {
  private userPool: cognito.UserPool;
  private _providers: cognito.UserPoolClientIdentityProvider[] = [];

  get providers(): cognito.UserPoolClientIdentityProvider[] {
    return this._providers;
  }

  constructor(scope: Construct, id: string, props: IdentityProviderProxyProps) {
    super(scope, id, {
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      ...props,
    });

    this.userPool = props.userPool;

    const emptyJsonResource = this.root.addResource("empty.json");
    emptyJsonResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [
        {
          statusCode: '200',
          responseTemplates: {
            'application/json': '{}',
          },
        },
      ],
      requestTemplates: {
        'application/json': '{\"statusCode\": 200}',
      },
      passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
    }),
    {
      methodResponses: [
        {
          statusCode: '200',
        },
      ],
    });

    props.providers.forEach((provider) => {
      this.attachProvider(provider);
    });
  }

  private attachProvider(provider: ProxyProvider) {
    switch(provider.provider) {
      case Provider.Github:
        this.github(provider);
        break;
      default:
        console.log(provider)
        throw new Error(`Provider '${provider.provider}' not implemented`);
    }
  }

  private github(provider: ProxyProvider) {
    const githubResource = this.root.addResource('github');

    const githubWellKnownResource = githubResource.addResource('.well-known');

    const githubDiscoveryResource = githubWellKnownResource.addResource('openid-configuration');
    githubDiscoveryResource.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [
        {
          statusCode: '200',
          responseTemplates: {
            'application/json': '#set($host = $context.domainName)\n' +
              '#if ($context.path.startsWith("/github/"))\n' +
              '  #set ($stage = "")\n' +
              '#else\n' +
              '  #set ($stage = "/${context.stage}")\n' +
              '#end\n' +
              '{\n' +
              '  "issuer": "https://${host}${stage}/github",\n' +
              '  "authorization_endpoint": "https://github.com/login/oauth/authorize",\n' +
              '  "token_endpoint": "https://${host}${stage}/github/access_token",\n' +
              '  "userinfo_endpoint": "https://${host}${stage}/github/user",\n' +
              '  "jwks_uri": "https://${host}${stage}/empty.json",\n' +
              '  "response_types_supported": ["code"],\n' +
              '  "subject_types_supported": ["public"],\n' +
              '  "id_token_signing_alg_values_supported": ["RS256"]\n' +
              '}\n',
          },
        },
      ],
      passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
      requestTemplates: {
        'application/json': '{\"statusCode\": 200}',
      },
    }),
    {
      methodResponses: [
        {
          statusCode: '200',
        }
      ],
    });


    const githubAccessTokenResource = githubResource.addResource('access_token');
    githubAccessTokenResource.addMethod(
      'POST',
      new apigateway.HttpIntegration(
        'https://github.com/login/oauth/access_token',
        {
          httpMethod: 'POST',
          options: {
            passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
            requestParameters: {
              'integration.request.header.Accept': "'application/json'",
            },
            integrationResponses: [
              {
                statusCode: '200',
              },
            ],
          },
          proxy: false,
        }
      ),
      {
        methodResponses: [
          {
            statusCode: '200',
          },
        ],
      }
    );


    const githubUserResource = githubResource.addResource('user');
    githubUserResource.addMethod(
      'GET',
      new apigateway.HttpIntegration(
        'https://api.github.com/user',
        {
          httpMethod: 'GET',
          proxy: false,
          options: {
            passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_TEMPLATES,
            requestParameters: {
              'integration.request.header.Authorization': 'method.request.header.Authorization',
            },
            integrationResponses: [
              {
                statusCode: '200',
                responseTemplates: {
                  'application/json':
                    '#set($body = $input.path(\'$\'))\n' +
                    '#set($body.sub = $body.id)\n' +
                    '#if(!$body.email)\n' +
                    '  #set($body.email_or_fake = $body.email)\n' +
                    '#else\n' +
                    '  #set($body.email_or_fake = "githubuser_${body.id}@${context.domainName}")\n' +
                    '#end\n' +
                    '#if(!$body.company)\n' +
                    '  #set($body.company_or_fake = $body.company)\n' +
                    '#else\n' +
                    '  #set($body.company_or_fake = "githubuser_\${body.id}@\${context.domainName}")\n' +
                    '#end\n' +
                    '$input.json(\'$\')\n',
                },
              },
              // {
              //   statusCode
              //   status_code="401",
              // //             selection_pattern="401",
              // //             response_templates={
              // //                 "application/json": "$input.json('$')",
              // //             },
              // },
            ],
            requestTemplates: {
              'application/json':
                '$input.json("$")\n' +
                '#set($context.requestOverride.header.Authorization = $input.params(\'Authorization\').replace("Bearer", "token"))\n'
            },
          },
        },
      ),
      {
        methodResponses: [
          {
            statusCode: '200',
          }
        ],
        requestParameters: {
          'method.request.header.Authorization': true,
        },
        requestValidatorOptions: {
          requestValidatorName: 'Validate query string parameters and headers',
          validateRequestBody: false,
          validateRequestParameters: true,
        },
      }
    );

    const providerOidc = new cognito.UserPoolIdentityProviderOidc(this, 'GithubProviderOidc', {
      userPool: this.userPool,
      name: 'Github',
      attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
      scopes: ['user', 'openid'],
      issuerUrl: this.urlForPath('/github'),
      ...provider,
    });

    this.userPool.registerIdentityProvider(providerOidc);

    new CfnOutput(this, 'AuthorizationCallbackUrl', {
      value: this.userPool.userPoolProviderUrl,
      description: 'Authorization callback URL',
    });

    this._providers.push(cognito.UserPoolClientIdentityProvider.custom('GithubProviderOidc'));
  }
}
