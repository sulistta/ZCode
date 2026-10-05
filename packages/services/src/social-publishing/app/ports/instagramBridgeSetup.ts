import type {
  InstagramBridgeConfiguration,
  InstagramBridgeSetup as SetupProjection,
  ProvisionInstagramBridgeRequest,
  ConfigureInstagramBridgeMetaRequest,
} from "@social-harness/shared";
export interface InstagramBridgeSetup {
  get(): Promise<SetupProjection>;
  provision(request: ProvisionInstagramBridgeRequest): Promise<SetupProjection>;
  configureMeta(request: ConfigureInstagramBridgeMetaRequest): Promise<SetupProjection>;
  validate(): Promise<SetupProjection>;
}
export interface InstagramBridgeConfigurationStore {
  read(): Promise<InstagramBridgeConfiguration | null>;
  write(config: InstagramBridgeConfiguration): Promise<void>;
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
}
export interface InstagramConvexProvisioner {
  createProject(input: {
    projectName: string;
    provisioningCredential: string;
  }): Promise<{ deploymentUrl: string; deployKey: string }>;
  configureMeta(input: {
    deploymentUrl: string;
    deployKey: string;
    appId: string;
    appSecret: string;
  }): Promise<void>;
  deploy(input: {
    deploymentUrl: string;
    deployKey: string;
    installationCredentialHash: string;
  }): Promise<void>;
}
