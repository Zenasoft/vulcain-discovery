//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
//    Copyright (c) Zenasoft
//
import {ContainerInfo} from './discover'
import {Options} from './options'
import {ConsulProvider} from './consulProvider'
//import {EtcdProvider} from './etcdProvider'
import * as os from 'os'

export interface ClusterDefinition {
    name: string;
    httpAddress: string;
    httpsAddress: string;
    proxyAddress?: string;
}

export interface ServicePortDefinition 
{
    port:number;
}

export interface ConfigDefinition 
{
    check:string;    
    balance:string;
    scheme:string;    
}

export interface ServiceVersionDefinition extends ConfigDefinition 
{
    publicPath:string;
    version:string;
    status:string;
    enabled:boolean;
    ports:Array<ServicePortDefinition>;
}

export interface ServiceDefinition extends ConfigDefinition 
{
    name:string;
    versions: Array<ServiceVersionDefinition>;
    port:number;
}

export interface IProvider {
    renewSessionAsync() : Promise<any>;
    createSessionAsync() : Promise<any>;
    getAsync(key:string, recursive?:boolean) : Promise<any>;
    setAsync(key:string, value:any, lock?:boolean) : Promise<any>;
    removeAsync(key:string, recurse?:boolean) : Promise<any>;
    watchChanges(key:string, queue, recurse:boolean, panic: (err)=>void); 
}

export class Reporter 
{
    private lastRefreshValue:string;
    private runtimePrefix:string;
    private sessionId:string;
    private lastIndex:string;
    private Options:Options;
    private hostKey:string;
    stop: boolean;
    provider:IProvider;
    // Watcher contexts
    private rw;
    private dw; 
    
    constructor(private options:Options, private panic: (err)=>void) 
    {
        this.options.ttl = options.ttl || 30;
        this.runtimePrefix = `vulcain/${options.cluster}/runtime/services/${options.hostName}`;  
        this.hostKey = `vulcain/${this.options.cluster}/runtime/hosts/${options.hostName}`;
        console.log("Starting consul reporter on " + (options.kv || "local-store"));
    }
    
    private createProvider() 
    {
        if(this.options.kv && this.options.kv.startsWith("consul://")) {
            this.options.kv = this.options.kv.substr("consul://".length);
            this.provider = new ConsulProvider(this.options);
        }
        else if (this.options.kv && this.options.kv.startsWith("etcd://")) {
            throw "Etcd not supported";
            //this.options.kv = this.options.kv.substr("etcd://".length);
            //this.provider = new EtcdProvider(this.options);            
        }
        else {
            this.provider = new ConsulProvider(this.options);         
        }
    }
    
    async startAsync() 
    {
        this.createProvider();
        
        let self = this;
        await this.provider.createSessionAsync();
        
        // Register host
        let hostDefinition = 
        {
            name: this.options.hostName, 
            ip:this.options.hostIp, 
            cluster:this.options.cluster,
            infos: {
                "platform": os.type(),
                "memory": os.totalmem() / 1024,
                "discovery" : this.options.version,
                "arch": os.arch(),
                "release" : os.release,
                "speed": os.cpus()[0].speed / 1000,
                "cpus": os.cpus().length
            }
        }; 
                
        // Register host
        await this.provider.setAsync(this.hostKey,JSON.stringify(hostDefinition));
        
        // Start the session renew process
        setTimeout( this.renewAsync.bind(this), this.options.ttl*1000/2);
    }
   
    watchChanges(runtimeQueue, defQueue) 
    {
        // Listening on changes in service definitions via webadmin
        // In this case, we will reset local services (for example a service has been disabled/enabled and must be updated)
        this.rw = this.provider.watchChanges(`vulcain/${this.options.cluster}/runtime/services/refresh`, runtimeQueue, true, this.panic.bind(this));
      
        // Listening on runtime changes updated by discovery agent (local or remote).
        // We don't know which agent initiate the changes so we will read all services 
        this.dw = this.provider.watchChanges(`vulcain/${this.options.cluster}/definitions/services/refresh`, defQueue, false, this.panic.bind(this));
    }

    dispose() {
        this.stop = true;
        this.rw && this.rw.dispose();
        this.dw && this.dw.dispose();
    }
    
    private async renewAsync() 
    {
        if(this.stop) return;
        
        let self = this;
        try 
        {
            await self.provider.renewSessionAsync();
            let host = await self.provider.getAsync(self.hostKey);
            if(!host) {
                self.panic("Host Watchdog failed.");
                return;
            }
            
            setTimeout( self.renewAsync.bind(self), self.options.ttl * 1000 / 2);
        }
        catch(e) {
            self.panic(e);
        }
    }
    
    async registerServiceAsync(service:ContainerInfo) 
    {
        await this.provider.setAsync(`${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`, JSON.stringify(service));
        if(this.options.debug)
            console.log(">> Service registered into kv store " + service.id ); 
    }
    
    notifyRuntimeChangedAsync()
    {
        return this.provider.setAsync(`vulcain/${this.options.cluster}/runtime/services/refresh`, Date.now().toString(), false); 
    }
    
    getRuntimeServicesAsync() {
        return this.provider.getAsync(`vulcain/${this.options.cluster}/runtime/services`, true);
    }
    
    async getClusterDefinitionAsync() : Promise<ClusterDefinition> {
        let key = `vulcain/definitions/clusters/${this.options.cluster}`;
        let data = await this.provider.getAsync(key);
        let result = data && JSON.parse(data.Value);
        if(this.options.debug) 
            console.log("Read data key=%s value=%j", key, result);
        return result;                
    }
    
    async getGlobalServicesAsync() : Promise<Array<ServiceDefinition>> {
        let key = `vulcain/${this.options.cluster}/definitions/globalServices/${name}`;
        let data = await this.provider.getAsync(key);
        return data.map(kv=>JSON.parse(kv.Value));              
    }
    
    async getServiceDefinitionAsync(name:string) : Promise<ServiceDefinition> {
        let key = `vulcain/${this.options.cluster}/definitions/services/${name}`;
        let data = await this.provider.getAsync(key);
        let result = data && JSON.parse(data.Value);
        if(this.options.debug) 
            console.log("Read data key=%s value=%j", key, result);
        return result;                
    }
    
    async getServiceVersionDefinitionAsync(name:string, version:string) : Promise<ServiceVersionDefinition> {
        let data = await this.provider.getAsync(`vulcain/${this.options.cluster}/definitions/services/${name}/${version}`);
        return data && JSON.parse(data.Value);
    }
    
    removeServicesAsync() {
        return this.provider.removeAsync(this.runtimePrefix, true);    
    }
    
    removeServiceAsync(service:ContainerInfo) 
    {
        return this.provider.removeAsync(`${this.runtimePrefix}/${service.name}/${service.version}/${service.id}`, true);     
    }
 }