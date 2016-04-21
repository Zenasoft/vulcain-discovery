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
/// <reference path="../typings/rx/rx.d.ts" />
/// <reference path="../typings/rx/rx-lite.d.ts" />
import {Discover, IRunner, ContainerInfo} from './discover'
import {EtcdProvider} from './etcdProvider'
import {Reporter} from './reporter'
import {Template} from './template'
import {Options} from './options'
import * as Util from 'util'
var Rx =require('rx')
import {ServiceInfo, VersionInfo} from './template'
import * as events from 'events';

export class Runner implements IRunner 
{
    private discover:Discover;
    private reporter: Reporter;
    private localServices : Map<string, ContainerInfo>;
    private runtimeQueue;
    private defQueue;
    private changes = 0;
    private clusterProxyAddress:string;
    private restarting:boolean;
    
    constructor(private options:Options) 
    {
        this.defQueue = new Rx.Subject();
        this.runtimeQueue = new Rx.Subject();
        this.localServices = new Map<string, ContainerInfo>();
        this.discover = new Discover(options, this);
        
        this.reporter = new Reporter(options, this.panic.bind(this));
    }
    
    private panic(err) 
    {
        if(this.restarting) return;
        this.restarting = true;
        this.reporter.stop = true;
        
        console.log("*** " + (err.stack||err));
        console.log("*** Restarting in 30 secondes ...");
        
        let self = this;
        setTimeout(function() 
        {
            if(self.restarting)
                process.exit(1);
        }, 30000);        
    }
    
    /**
     * Start by inspecting containers of the current host
     */
    async startAsync() 
    {    
        try 
        {
            this.clusterProxyAddress = await this.discover.findProxyAddressAsync();
            console.log("Proxy address is " + this.clusterProxyAddress);
            
//            await this.reporter.removeServicesAsync();
            this.discover.start(this, this.panic.bind(this));            
            await this.reporter.startAsync();
            
            // Inspect local containers, update kv
            Util.log("Inspecting local containers.");
            let containers =  await this.discover.listContainersAsync();
            containers.forEach(async (container:ContainerInfo)=> 
            {
                if(container)
                    await this.addService(container);
            });
            
            // Start listening changes in kv
            this.runtimeQueue
                .debounce(this.options.refresh*1000)
                .subscribe(this.onRuntimeChanged.bind(this)); 
            this.defQueue
                .debounce(this.options.refresh*1000)
                .subscribe(this.refreshLocalAsync.bind(this)); 
 
            this.reporter.watchChanges(this.runtimeQueue, this.defQueue);
            
            // Notify other agents
            await this.reporter.notifyRuntimeChangedAsync();
       }
       catch(e) {
           this.panic(e);
       }
    }
    
    async refreshLocalAsync() 
    {
        if(this.changes == 0 || this.restarting) return;
        try 
        {
            Util.log("Definitions change occurred. Refreshing local containers...");
            await this.reporter.removeServicesAsync();
            let containers =  await this.discover.listContainersAsync();
            containers.forEach(async (container:ContainerInfo)=> 
            {
                if(container) {
                    container = await this.addService(container);
                }
            });     
            
            // Force rebuild proxy configurations with all services
            this.runtimeQueue.onNext(false);
        }
        catch(e) {
            this.panic(e);
        }   
    }
    
    async serviceAdded(id:string) 
    {
        try {
            let container = await this.discover.inspectContainerAsync(id);
            if(!container)
            {
                return;
            }
            await this.addService(container);
            await this.reporter.notifyRuntimeChangedAsync();
        }
        catch(e) {
            this.panic(e);
        }
    }
    
    private async addService(container:ContainerInfo)
    {
        try
        {            
            if(this.restarting) return;
            
            // Target another specific cluster ?
            if( !container.cluster || container.cluster.toLowerCase() !== this.options.cluster.toLowerCase())
                return;
                
            // Is it a valid and enabled version ?
            if(this.options.proxyMode !== "dev") 
            {
                let vdef = await this.reporter.getServiceVersionDefinitionAsync(container.name, container.version);
                if(!vdef || !vdef.enabled ) return;
                let def = await this.reporter.getServiceDefinitionAsync(container.name);
            
                container.balance = vdef.balance || def.balance;
                container.scheme = vdef.scheme || def.scheme;
                container.check  = vdef.check || def.check;
                container.port = def.port;
                container.address = `${this.clusterProxyAddress}:${def.port}`;
                container.publicPath = vdef.publicPath;
            }
            
            // OK, service can be registered
            await this.reporter.registerServiceAsync(container);
            this.localServices.set(container.id, container);
            
            Util.log(`Service ${container.name} version ${container.version} added (id=${container.id})`);
            return container;
        }
        catch(e) {
            this.panic(e);          
        }
    }
    
    async serviceRemoved(id:string) 
    {
        try 
        {
            let container = this.localServices.get(id);
            if(container) {
                this.localServices.delete(id);
                await this.reporter.removeServiceAsync(container);
                Util.log(`Service ${container.name} version ${container.version} removed (id=${id})`);   
                await this.reporter.notifyRuntimeChangedAsync();         
            }
        }
        catch(e) {
            this.panic(e);          
        }
    }
    
    private async onRuntimeChanged() 
    {      
        if(this.restarting) {
            Util.log("Ignore changes, pending restart...");
            return;
        }

    //    let globals = await this.reporter.getGlobalServicesAsync();        
        let containers = await this.reporter.getRuntimeServicesAsync();
        if(this.options.debug)
            Util.log(`onRuntimeChanged with ${containers.length} containers`);
    
        this.changes++;        
        let services = new Map<string,ServiceInfo>();
        let cx=0;
       
        try 
        { 
            let cluster = await this.reporter.getClusterDefinitionAsync();
            if(cluster ) 
            {
                cluster.proxyAddress = this.clusterProxyAddress;
                if(this.options.proxyMode === "dev") {
                    cluster.httpAddress = "*";
                    cluster.httpsAddress = "*";
                }
                        
                // Aggregate container by service/versions/containers
                for(let kv of containers) 
                {
                    if(kv.Key.split("/").length === 5) continue; // refresh
                    let container = <ContainerInfo>JSON.parse(kv.Value);        
                    if(!container) continue;
                    
                    let service = services.get(container.name);
                    if(!service)
                    {
                        service = {name:container.name, versions:[], port:container.port, scheme:container.scheme};
                        services.set(container.name, service);
                    }
                    
                    let version = service.versions.find(v=>v.version===container.version);
                    if(!version) {
                        version = {instances:[], version:container.version, balance:container.balance, check:container.check}
                        // Insert in order (ascending)
                        let idx = service.versions.findIndex(v=>v.version>version.version);
                        if(idx < 0) idx = service.versions.length;
                        service.versions.splice(idx, 0, version);                
                    }
                    
                    version.instances.push(container);
                    cx++;                
                }
            }
            
            // Notify template 
            let template = new Template(this.options);
            Util.log(`Generating template file with ${services.size} services (${cx} instances)`);
            await template.transformAsync(cluster, Array.from(services.values()));
        }
        catch(err) {
            this.panic(err);          
        }
    }
}
